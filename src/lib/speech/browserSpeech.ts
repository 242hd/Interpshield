import { SpeechServiceOptions, TranscriptResult } from './deepgram';

export class BrowserSpeechService {
  private options: SpeechServiceOptions;
  private recognition: any = null;
  private isListening: boolean = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private animationFrameId: number | null = null;
  private stream: MediaStream | null = null;

  constructor(options: SpeechServiceOptions) {
    this.options = options;
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.options.onError('Speech Recognition is not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.options.language || 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.options.onStatusChange('listening');
    };

    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;

        this.options.onTranscript({
          text: transcript,
          isFinal: isFinal,
          timestamp: Date.now(),
          detectedLanguage: this.options.language // Browser API doesn't auto-detect well, fallback to selected
        });
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('Browser Speech Error:', event.error);
      if (event.error === 'not-allowed') {
        this.options.onError('Microphone permission denied.');
      } else if (event.error !== 'aborted') {
        this.options.onError(`Speech recognition error: ${event.error}`);
      }
      this.stop();
    };

    this.recognition.onend = () => {
      if (this.isListening) {
        // Auto-restart if it stopped unexpectedly
        try {
          this.recognition.start();
        } catch (e) {
          this.stop();
        }
      } else {
        this.options.onStatusChange('idle');
      }
    };
  }

  private setupAudioAnalysis(stream: MediaStream) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.microphone = this.audioContext.createMediaStreamSource(stream);
    this.microphone.connect(this.analyser);

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const updateVolume = () => {
      if (!this.analyser || !this.isListening) return;
      this.analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      const volume = Math.min(1, average / 128);
      
      if (this.options.onVolumeChange) {
        this.options.onVolumeChange(volume);
      }
      
      this.animationFrameId = requestAnimationFrame(updateVolume);
    };

    updateVolume();
  }

  public async start() {
    if (!this.recognition) {
      this.options.onError('Speech Recognition is not supported in this browser.');
      return;
    }

    try {
      this.options.onStatusChange('requesting_permission');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.options.onStatusChange('permission_granted');
      
      this.setupAudioAnalysis(this.stream);
      
      this.recognition.lang = this.options.language || 'en-US';
      this.recognition.start();
    } catch (error) {
      console.error('Error starting browser speech:', error);
      this.options.onError('Could not access microphone.');
      this.options.onStatusChange('error');
    }
  }

  public pause() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
  }

  public resume() {
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) {}
    }
  }

  public stop() {
    this.isListening = false;
    
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.options.onVolumeChange) {
      this.options.onVolumeChange(0);
    }
    
    this.options.onStatusChange('idle');
  }
}
