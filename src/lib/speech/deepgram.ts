/**
 * Deepgram Speech-to-Text Library
 * Handles microphone audio processing and transcription.
 */

import { DeepgramClient } from "@deepgram/sdk";

export interface DebugInfo {
  permissionState: PermissionState | 'unknown';
  deviceName: string;
  streamActive: boolean;
  socketConnected: boolean;
  chunksSent: number;
  lastChunkTimestamp: number;
  lastTranscriptTimestamp: number;
  lastTranscript: string;
  lastError: string;
  metrics?: {
    connectionLatency?: number;
    firstResponseTime?: number;
    avgUpdateInterval?: number;
    translationLatency?: number;
  };
}

export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  timestamp: number;
  detectedLanguage?: string;
}

export interface SpeechServiceOptions {
  onTranscript: (result: TranscriptResult) => void;
  onStatusChange: (status: 'idle' | 'requesting_permission' | 'permission_granted' | 'testing' | 'recording_started' | 'deepgram_connected' | 'listening' | 'processing' | 'error') => void;
  onError: (error: string) => void;
  onDebugUpdate?: (info: DebugInfo) => void;
  onVolumeChange?: (volume: number) => void;
  apiKey?: string;
  language?: string;
  detectLanguage?: boolean;
}

export class DeepgramSpeechService {
  private options: SpeechServiceOptions;
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private currentStream: MediaStream | null = null;
  private firstChunkSent = false;
  private keepAliveInterval: any = null;
  private isStopping = false;
  
  // Metrics
  private startTime: number = 0;
  private connectTime: number = 0;
  private firstResponseTime: number = 0;
  private lastResponseTime: number = 0;
  private responseCount: number = 0;
  private totalInterval: number = 0;

  private debugInfo: DebugInfo = {
    permissionState: 'unknown',
    deviceName: 'None',
    streamActive: false,
    socketConnected: false,
    chunksSent: 0,
    lastChunkTimestamp: 0,
    lastTranscriptTimestamp: 0,
    lastTranscript: '',
    lastError: ''
  };

  constructor(options: SpeechServiceOptions) {
    this.options = options;
    this.checkPermission();
  }

  private async checkPermission() {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as any });
      this.updateDebug({ permissionState: result.state });
      result.onchange = () => {
        this.updateDebug({ permissionState: result.state });
      };
    } catch (e) {
      console.warn('Permission query not supported', e);
    }
  }

  private updateDebug(patch: Partial<DebugInfo>) {
    this.debugInfo = { ...this.debugInfo, ...patch };
    this.options.onDebugUpdate?.(this.debugInfo);
  }

  private isPaused = false;

  pause() {
    this.isPaused = true;
    console.log('⏸️ [Deepgram] Session paused');
  }

  resume() {
    this.isPaused = false;
    console.log('▶️ [Deepgram] Session resumed');
  }

  async start() {
    this.isStopping = false;
    if (this.currentStream) {
      return this.connectToDeepgram(this.currentStream);
    }

    const apiKey = this.options.apiKey;
    console.log('🔑 [Deepgram] Validating API Key...');
    
    if (!apiKey || apiKey === 'null' || apiKey === 'undefined' || apiKey.length < 10) {
      console.error('❌ [Deepgram] Invalid API Key detected');
      const msg = 'Deepgram API Key is missing or invalid.';
      this.updateDebug({ lastError: msg });
      this.options.onError(msg);
      return;
    }

    try {
      console.log('🎙️ [Deepgram] Requesting microphone permission...');
      this.options.onStatusChange('requesting_permission');
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.currentStream = stream;
      console.log('✅ [Deepgram] Microphone permission granted');
      this.options.onStatusChange('permission_granted');
      
      return this.connectToDeepgram(stream);
    } catch (error) {
      this.handleError(error);
    }
  }

  async testMicrophone(): Promise<MediaStream | null> {
    try {
      console.log('🎙️ [Deepgram] Testing microphone...');
      this.options.onStatusChange('requesting_permission');
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.currentStream = stream;
      console.log('✅ [Deepgram] Microphone permission granted for test');
      this.options.onStatusChange('testing');
      
      const track = stream.getAudioTracks()[0];
      this.updateDebug({ 
        deviceName: track?.label || 'Unknown',
        streamActive: stream.active,
        chunksSent: 0,
        lastError: ''
      });

      this.setupVolumeMonitor(stream);
      return stream;
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  private setupVolumeMonitor(stream: MediaStream) {
    if (this.audioContext) this.audioContext.close();
    
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateVolume = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const volume = Math.min(100, Math.round((average / 128) * 100));
      
      this.options.onVolumeChange?.(volume);
      this.animationFrame = requestAnimationFrame(updateVolume);
    };
  }

  async connectToDeepgram(stream: MediaStream) {
    const apiKey = this.options.apiKey;
    if (!apiKey) {
      this.options.onError('API Key missing');
      return;
    }

    try {
      console.log('🎙️ [Deepgram] 1. Preparing audio pipeline...');
      const track = stream.getAudioTracks()[0];
      this.updateDebug({ 
        deviceName: track?.label || 'Unknown',
        streamActive: stream.active,
        chunksSent: 0,
        lastError: ''
      });
      
      this.firstChunkSent = false;
      this.startTime = Date.now();
      this.responseCount = 0;
      this.totalInterval = 0;

      // --- STEP 1: Setup Audio Pipeline ---
      
      // Close existing context if any
      if (this.audioContext) {
        console.log('🧹 [Deepgram] Closing existing AudioContext');
        await this.audioContext.close();
      }

      // Initialize AudioContext for PCM capture and resampling
      console.log('🔊 [Deepgram] Initializing AudioContext (16kHz)...');
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      
      if (this.audioContext.state === 'suspended') {
        console.log('▶️ [Deepgram] Resuming suspended AudioContext');
        await this.audioContext.resume();
      }

      this.source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.source.connect(this.analyser);

      // ScriptProcessorNode for raw PCM extraction
      console.log('⚙️ [Deepgram] Creating ScriptProcessorNode');
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // --- STEP 2: Setup Audio Processing ---
      console.log('⚙️ [Deepgram] 2. Setting up audio processing...');
      
      if (!this.processor) return;
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        let hasData = false;
        
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          if (pcmData[i] !== 0) hasData = true;
        }

        if (hasData || this.socket?.readyState === 1) {
          const buffer = pcmData.buffer.slice(0);
          
          // If socket is open, send data
          if (this.socket?.readyState === 1 && !this.isPaused) {
            this.socket.send(pcmData.buffer);
            const now = Date.now();
            if (!this.firstChunkSent) {
              console.log('📤 [Deepgram] 4. First audio chunk sent to WebSocket');
              this.firstChunkSent = true;
            }
            this.updateDebug({ 
              chunksSent: this.debugInfo.chunksSent + 1,
              lastChunkTimestamp: now
            });
          }
        }
      };

      // --- STEP 3: Open WebSocket connection ---
      console.log('🛰️ [Deepgram] 3. Opening WebSocket connection...');
      const lang = this.options.language || 'en';
      const detect = this.options.detectLanguage ? '&detect_language=true' : `&language=${lang}`;
      const url = `wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&interim_results=true&punctuate=true&endpointing=300${detect}`;
      
      this.socket = new WebSocket(url, ['token', apiKey]);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = () => {
        this.connectTime = Date.now();
        const latency = this.connectTime - this.startTime;
        console.log(`📡 [Deepgram] 4. WebSocket connected (Latency: ${latency}ms)`);
        
        this.updateDebug({ 
          socketConnected: true,
          metrics: { ...this.debugInfo.metrics, connectionLatency: latency }
        });
        
        this.options.onStatusChange('deepgram_connected');
        this.options.onStatusChange('listening');

        // Start keep-alive heartbeat
        this.startKeepAlive();
      };

      this.socket.onmessage = (message) => {
        const now = Date.now();
        const data = JSON.parse(message.data);
        const transcript = data.channel?.alternatives[0]?.transcript;
        const detectedLanguage = data.detected_language;
        
        if (transcript) {
          if (this.responseCount === 0) {
            this.firstResponseTime = now;
            const firstResponseLatency = now - this.connectTime;
            console.log(`📥 [Deepgram] First transcript received in ${firstResponseLatency}ms`);
            this.updateDebug({
              metrics: { ...this.debugInfo.metrics, firstResponseTime: firstResponseLatency }
            });
          } else {
            const interval = now - this.lastResponseTime;
            this.totalInterval += interval;
            const avgInterval = Math.round(this.totalInterval / this.responseCount);
            this.updateDebug({
              metrics: { ...this.debugInfo.metrics, avgUpdateInterval: avgInterval }
            });
          }
          
          this.responseCount++;
          this.lastResponseTime = now;

          if (data.is_final) {
            console.log('📥 [Deepgram] Final transcript received:', transcript);
          }
          
          this.updateDebug({ 
            lastTranscript: transcript,
            lastTranscriptTimestamp: now
          });
          this.options.onTranscript({
            text: transcript,
            isFinal: data.is_final,
            timestamp: now,
            detectedLanguage
          });
        }
      };

      this.socket.onerror = (err) => {
        console.error('❌ [Deepgram] WebSocket error:', err);
        const msg = 'Deepgram connection error';
        this.updateDebug({ lastError: msg, socketConnected: false });
        this.options.onError(msg);
      };

      this.socket.onclose = (event) => {
        console.log('📡 [Deepgram] WebSocket connection closed. Code:', event.code, 'Reason:', event.reason || 'No reason provided');
        this.updateDebug({ socketConnected: false });
        this.stopKeepAlive();
        
        if (event.code !== 1000 && !this.isStopping) {
          console.log('🔄 [Deepgram] Unexpected closure, attempting to reconnect...');
          const msg = `Deepgram closed: ${event.reason || 'Timeout'}. Reconnecting...`;
          this.updateDebug({ lastError: msg });
          
          // Attempt to reconnect after a short delay
          setTimeout(() => {
            if (!this.isStopping && this.currentStream) {
              this.connectToDeepgram(this.currentStream);
            }
          }, 2000);
        } else {
          this.options.onStatusChange('idle');
        }
      };

    } catch (error) {
      this.handleError(error);
    }
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.socket?.readyState === 1) {
        // Deepgram expects a JSON string for keep-alive
        this.socket.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, 5000); // Send every 5 seconds
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private handleError(error: any) {
    console.error('❌ [Deepgram] Error:', error);
    const msg = error instanceof Error ? error.message : 'Microphone access denied';
    this.updateDebug({ lastError: msg, streamActive: false });
    this.options.onStatusChange('error');
    this.options.onError(msg);
  }

  stop() {
    console.log('🛑 [Deepgram] Stopping session...');
    this.isStopping = true;
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.currentStream?.getTracks().forEach(track => {
      track.stop();
    });
    this.currentStream = null;
    
    this.updateDebug({ streamActive: false, socketConnected: false });

    if (this.socket) {
      this.socket.close(1000);
      this.socket = null;
    }
    
    this.stopKeepAlive();
    this.options.onStatusChange('idle');
  }
}
