// src/App.tsx
import React from 'react';
import './App.css';
import { useReactMediaRecorder } from './voice';

const App: React.FC = () => {
    const {
      hypotheses,
      startRecording,
      stopRecording,
    } = useReactMediaRecorder({ separate: false });

    console.log("Voice to text: ", hypotheses);

  return (
    <div className="App">
      Voice Example

      <button onClick={startRecording}>Start Recording</button>
      <button onClick={stopRecording}>Stop Recording</button>
    </div>
  );
};

export default App;

