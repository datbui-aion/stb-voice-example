import { ReactElement, useCallback, useEffect, useRef, useState } from 'react'

const API_URL = 'wss://sacombank.asr.interits.com/client/ws/speech'

/**
 * Chuyển dữ liệu mảng 32 bit về 16 bit.
 * @param float32ArrayData
 */
const convertFloat32ToInt16 = float32ArrayData => {
    var l = float32ArrayData.length
    var int16ArrayData = new Int16Array(l)
    while (l--) {
        int16ArrayData[l] = Math.min(1, float32ArrayData[l]) * 0x7fff
    }
    return int16ArrayData
}

export type ReactMediaRecorderRenderProps = {
    hypotheses: any
    error: string
    muteAudio: () => void
    unMuteAudio: () => void
    startRecording: () => void
    pauseRecording: () => void
    resumeRecording: () => void
    stopRecording: () => void
    blob: null | Blob
    status: StatusMessages
    isAudioMuted: boolean
    previewStream: MediaStream | null
    previewAudioStream: MediaStream | null
    clearBlobUrl: () => void
}

export type ReactMediaRecorderHookProps = {
    audio?: boolean | MediaTrackConstraints
    record?: boolean | MediaTrackConstraints
    onStop?: (blobUrl: string, blob: Blob) => void
    blobPropertyBag?: BlobPropertyBag
    //@ts-ignore
    mediaRecorderOptions?: MediaRecorderOptions | null
    askPermissionOnMount?: boolean
    separate?: boolean
}
export type ReactMediaRecorderProps = ReactMediaRecorderHookProps & {
    render: (props: ReactMediaRecorderRenderProps) => ReactElement
}

export type StatusMessages =
    | 'media_aborted'
    | 'permission_denied'
    | 'no_specified_media_found'
    | 'media_in_use'
    | 'invalid_media_constraints'
    | 'no_constraints'
    | 'recorder_error'
    | 'idle'
    | 'acquiring_media'
    | 'delayed_start'
    | 'recording'
    | 'stopping'
    | 'stopped'
    | 'paused'

export enum RecorderErrors {
    AbortError = 'media_aborted',
    NotAllowedError = 'permission_denied',
    NotFoundError = 'no_specified_media_found',
    NotReadableError = 'media_in_use',
    OverconstrainedError = 'invalid_media_constraints',
    TypeError = 'no_constraints',
    NONE = '',
    NO_RECORDER = 'recorder_error',
}

export function useReactMediaRecorder({
    audio = true,
    record = false,
    onStop = () => null,
    blobPropertyBag,
    mediaRecorderOptions = null,
    askPermissionOnMount = false,
    separate = true,
}: ReactMediaRecorderHookProps): ReactMediaRecorderRenderProps {
    //@ts-ignore
    const mediaRecorder = useRef<MediaRecorder | null>(null)
    const mediaChunks = useRef<Blob[]>([])
    const mediaStream = useRef<MediaStream | null>(null)
    const audioContext = useRef<AudioContext | null>(null)
    const ws = useRef<WebSocket | null>(null)

    const [status, setStatus] = useState<StatusMessages>('idle')
    const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false)
    const [blob, setBlob] = useState<Blob | null>(null)
    const [error, setError] = useState<keyof typeof RecorderErrors>('NONE')
    const [hypotheses, setHypotheses] = useState(null)

    const getMediaStream = useCallback(async () => {
        setStatus('acquiring_media')
        const requiredMedia: MediaStreamConstraints = {
            audio: typeof audio === 'boolean' ? !!audio : audio,
        }
        try {
            const stream = await window.navigator.mediaDevices.getUserMedia(requiredMedia)
            mediaStream.current = stream

            audioContext.current = new (window.AudioContext)()
            if (audioContext.current.state === 'suspended') {
                audioContext.current.resume()
            }
            console.log('setStatus idle')

            setStatus('idle')
        } catch (error: any) {
            setError(error.name)
            setStatus('idle')
            console.log('error', error)


        }
    }, [audio])

    const processJsonResponse = useCallback(
        resp => {
            if (resp.status === 0 && resp.result && resp.result.hypotheses.length > 0) {
                var transcript = resp.result.hypotheses[0].transcript_normed || resp.result.hypotheses[0].transcript
                var text = transcript

                // Không nhận dạng được
                if (text === '<unk>.') {
                    return
                }
                // console.log(resp)
                if (resp['total-length']) {
                    const newValue = {
                        text: transcript,
                        transcript: resp.result.hypotheses[0].transcript,
                    }
                    setHypotheses(newValue)
                    if (separate) stopRecording()
                }
            }
        },
        [hypotheses],
    )

    useEffect(() => {
        //@ts-ignore
        if (!window.MediaRecorder) {
            throw new Error('Unsupported Browser')
        }

        const checkConstraints = (mediaType: MediaTrackConstraints) => {
            const supportedMediaConstraints = navigator.mediaDevices.getSupportedConstraints()
            const unSupportedConstraints = Object.keys(mediaType).filter(constraint => !(supportedMediaConstraints as { [key: string]: any })[constraint])

            if (unSupportedConstraints.length > 0) {
                console.error(`The constraints ${unSupportedConstraints.join(',')} doesn't support on this browser. Please check your ReactMediaRecorder component.`)
            }
        }

        if (typeof audio === 'object') {
            checkConstraints(audio)
        }

        if (mediaRecorderOptions && mediaRecorderOptions.mimeType) {
            //@ts-ignore
            if (!MediaRecorder.isTypeSupported(mediaRecorderOptions.mimeType)) {
                console.error('The specified MIME type you supplied for MediaRecorder doesn\'t support this browser')
            }
        }

        if (!mediaStream.current && askPermissionOnMount) {
            getMediaStream()
        }

        return () => {
            if (mediaStream.current) {
                const tracks = mediaStream.current.getTracks()
                tracks.forEach(track => track.stop())
            }
        }
    }, [audio, getMediaStream, mediaRecorderOptions, askPermissionOnMount])

    // Media Recorder Handlers

    const startRecording = async () => {
        console.log('mediaStream')

        setError('NONE')
        if (!mediaStream.current) {
            await getMediaStream()
        }
        if (mediaStream.current) {
            console.log('mediaStream.current')

            const isStreamEnded = mediaStream.current.getTracks().some(track => track.readyState === 'ended')
            if (isStreamEnded) {
                await getMediaStream()
            }

            // User blocked the permissions (getMediaStream errored out)
            if (!mediaStream.current.active) {
                return
            }
            //@ts-ignore
            mediaRecorder.current = new MediaRecorder(mediaStream.current)
            mediaRecorder.current.ondataavailable = onRecordingActive
            mediaRecorder.current.onstop = onRecordingStop
            mediaRecorder.current.onerror = err => {
                console.log('ERRR', err)
                setError('NO_RECORDER')
                setStatus('idle')
            }
            mediaRecorder.current.start()
            console.log('Start recording')
            setStatus('recording')
        }

        if (audioContext.current) {
            var bufferSize = 2048

            //@ts-ignore
            const audioInput = audioContext.current.createMediaStreamSource(mediaStream.current)
            const recorder = audioContext.current.createScriptProcessor(bufferSize, 1, 1)

            // Xử lý dữ liệu audio
            recorder.onaudioprocess = e => {
                if (ws.current && ws.current.readyState === ws.current.OPEN) {
                    const buffer = e.inputBuffer.getChannelData(0)
                    var int16ArrayData = convertFloat32ToInt16(buffer)
                    ws.current.send(int16ArrayData.buffer)
                }
            }

            audioInput.connect(recorder)
            recorder.connect(audioContext.current.destination)

            // Địa chỉ URI của web socket
            var url =
                API_URL +
                '?content-type=audio/x-raw' +
                ',+layout=(string)interleaved' +
                ',+rate=(int)' +
                audioContext.current.sampleRate +
                ',+format=(string)S16LE' +
                ',+channels=(int)1'

            ws.current = new WebSocket(url)
            ws.current.onopen = function () {
                console.log('Opened connection to websocket ' + url)
            }

            ws.current.onerror = function (err) {
                console.log('first,', err)
            }

            ws.current.onclose = () => {
                console.log('Websocket closed')
                // setIsSocketOpen(false)
                stopRecording()
            }
            ws.current.onmessage = function (e) {
                var resp = JSON.parse(e.data)
                processJsonResponse(resp)
            }
        }
    }

    //@ts-ignore
    const onRecordingActive = ({ data }: BlobEvent) => {
        mediaChunks.current.push(data)
    }

    const onRecordingStop = useCallback(() => {
        if (record) {
            const [chunk] = mediaChunks.current
            const blobProperty: BlobPropertyBag = Object.assign({ type: chunk.type }, blobPropertyBag || { type: 'audio/wav' })
            const blob = new Blob(mediaChunks.current, blobProperty)
            setBlob(blob)
            onStop(hypotheses, blob)
        }
        setStatus('stopped')
    }, [mediaChunks, hypotheses])

    const muteAudio = (mute: boolean) => {
        setIsAudioMuted(mute)
        if (mediaStream.current) {
            mediaStream.current.getAudioTracks().forEach(audioTrack => (audioTrack.enabled = !mute))
        }
    }

    const pauseRecording = () => {
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
            setStatus('paused')
            mediaRecorder.current.pause()
        }
    }
    const resumeRecording = () => {
        if (mediaRecorder.current && mediaRecorder.current.state === 'paused') {
            setStatus('recording')
            mediaRecorder.current.resume()
        }
    }

    const stopRecording = () => {
        console.log('Stopping voice')
        if (ws.current && ws.current.readyState === ws.current.OPEN) ws.current.send('EOS')
        if (mediaRecorder.current) {
            if (mediaRecorder.current.state !== 'inactive') {
                setStatus('stopping')
                mediaRecorder.current.stop()
                mediaStream.current && mediaStream.current.getTracks().forEach(track => track.stop())
                mediaChunks.current = []
            }
        }

        if (audioContext.current) {
            if (audioContext.current.state !== 'closed') {
                audioContext.current.close()
            }
        }
    }

    return {
        hypotheses,
        error: RecorderErrors[error],
        muteAudio: () => muteAudio(true),
        unMuteAudio: () => muteAudio(false),
        startRecording,
        pauseRecording,
        resumeRecording,
        stopRecording,
        blob,
        status,
        isAudioMuted,
        previewStream: mediaStream.current ? new MediaStream(mediaStream.current.getVideoTracks()) : null,
        previewAudioStream: mediaStream.current ? new MediaStream(mediaStream.current.getAudioTracks()) : null,
        clearBlobUrl: () => {
            setBlob(null)
            setStatus('idle')
        },
    }
}

export const ReactMediaRecorder = (props: ReactMediaRecorderProps) => props.render(useReactMediaRecorder(props))
