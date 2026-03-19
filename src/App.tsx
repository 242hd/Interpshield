/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  Share2, 
  Lock, 
  X,
  Key,
  Sparkles,
  Play, 
  Pause, 
  ChevronDown, 
  ArrowRightLeft,
  Languages,
  Shield,
  Info,
  AlertCircle,
  Timer,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  VolumeX,
  RefreshCw,
  Mic, 
  MicOff, 
  Globe, 
  Volume2, 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Libraries ---
import { DeepgramSpeechService, DebugInfo } from './lib/speech/deepgram';
import { BrowserSpeechService } from './lib/speech/browserSpeech';
import { translateText } from './lib/translation/gemini';
import { speak, stopSpeaking } from './lib/tts/browserTTS';
import { getMockTranscript, getMockTranslation } from './lib/demo/mockSession';

// --- Types ---

type Mode = 'transcribe' | 'translate' | 'dubbing';
type SessionStatus = 'idle' | 'requesting_permission' | 'permission_granted' | 'recording_started' | 'deepgram_connected' | 'listening' | 'processing' | 'speaking' | 'error';

interface Language {
  code: string;
  name: string;
  voiceCode: string;
}

const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', voiceCode: 'en-US' },
  { code: 'es', name: 'Spanish', voiceCode: 'es-ES' },
  { code: 'fr', name: 'French', voiceCode: 'fr-FR' },
  { code: 'ar', name: 'Arabic', voiceCode: 'ar-SA' },
  { code: 'zh', name: 'Chinese', voiceCode: 'zh-CN' },
  { code: 'de', name: 'German', voiceCode: 'de-DE' },
  { code: 'pt', name: 'Portuguese', voiceCode: 'pt-PT' },
  { code: 'ja', name: 'Japanese', voiceCode: 'ja-JP' },
];

// --- Components ---

const LanguageSelector = ({ 
  label, 
  value, 
  onChange 
}: { 
  label: string, 
  value: string, 
  onChange: (val: string) => void 
}) => (
  <div className="flex flex-col gap-1.5 flex-1">
    <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</label>
    <div className="relative group">
      <select 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-slate-800/50 border border-slate-700 text-slate-200 py-2.5 px-4 pr-10 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 transition-all cursor-pointer"
      >
        {LANGUAGES.map(lang => (
          <option key={lang.code} value={lang.code}>{lang.name}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none group-hover:text-slate-300 transition-colors" />
    </div>
  </div>
);

const Toggle = ({ 
  label, 
  active, 
  onClick, 
  icon: Icon 
}: { 
  label: string, 
  active: boolean, 
  onClick: () => void,
  icon?: any
}) => (
  <button 
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
      active 
        ? 'bg-brand/10 text-brand border border-brand/20' 
        : 'text-slate-500 border border-transparent hover:bg-slate-800'
    }`}
  >
    {Icon && <Icon className="w-4 h-4" />}
    {label}
  </button>
);

export default function App() {
  const [mode, setMode] = useState<Mode>('translate');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('es');
  const [isTwoWay, setIsTwoWay] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  
  const [transcript, setTranscript] = useState<string[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [translation, setTranslation] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasDeepgramKey, setHasDeepgramKey] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [isAIStudio, setIsAIStudio] = useState(false);
  const [isGeminiActive, setIsGeminiActive] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [autoDetect, setAutoDetect] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [copyStatus, setCopyStatus] = useState<{[key: string]: boolean}>({});
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const translationEndRef = useRef<HTMLDivElement>(null);
  const speechServiceRef = useRef<DeepgramSpeechService | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [geminiKey, setGeminiKey] = useState<string | null>(null);

  // Timer logic
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
      if (status === 'listening' && !isPaused) {
        setSessionTime(prev => prev + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status, isPaused]);

  // Check for API keys on mount
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        
        setHasDeepgramKey(config.hasDeepgramKey);
        setHasGeminiKey(config.hasGeminiKey);
        setIsAIStudio(config.isAIStudio);
        setIsGeminiActive(config.hasGeminiKey || !!config.geminiApiKey);
        
        if (config.geminiApiKey && config.geminiApiKey !== 'null' && config.geminiApiKey !== 'undefined') {
          setGeminiKey(config.geminiApiKey);
        }
      } catch (e) {
        console.error('❌ Failed to fetch config:', e);
      }
    };
    checkConfig();
  }, []);

  // Auto-scroll
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  useEffect(() => {
    translationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [translation]);

  // Handle real-time translation and TTS
  const processNewTranscript = async (result: any) => {
    const { text, isFinal, detectedLanguage } = result;
    
    if (detectedLanguage) {
      setDetectedLang(detectedLanguage);
    }

    if (!text.trim()) return;

    if (!isFinal) {
      setInterimTranscript(text);
      return;
    }

    // Final result processing
    setInterimTranscript('');
    
    // Deduplication and merging logic
    let isDuplicate = false;
    setTranscript(prev => {
      if (prev.length > 0) {
        const last = prev[prev.length - 1].toLowerCase().trim();
        const current = text.toLowerCase().trim();
        
        // Skip exact duplicates
        if (last === current) {
          isDuplicate = true;
          return prev;
        }

        // If the current text is just a subset of the last one (common in streaming)
        if (last.endsWith(current) || last.includes(current) && current.length < 15) {
          isDuplicate = true;
          return prev;
        }

        // If the last text is a subset of the current one, replace it (merging fragments)
        if (current.startsWith(last) && current.length > last.length) {
          const newTranscript = [...prev];
          newTranscript[newTranscript.length - 1] = text;
          isDuplicate = true; // We handled it by updating, so don't append
          return newTranscript;
        }
      }
      return [...prev, text];
    });

    if (isDuplicate) return;
    
    // Parallel Translation logic
    if (mode === 'translate' || mode === 'dubbing') {
      const canTranslate = hasGeminiKey || !!geminiKey;
      
      if (canTranslate) {
        // Run translation in parallel without blocking
        (async () => {
          setIsTranslating(true);
          try {
            const activeSourceLang = (autoDetect && detectedLang) ? detectedLang : sourceLang;
            const sourceLangName = LANGUAGES.find(l => l.code === activeSourceLang)?.name || activeSourceLang;
            const targetLangName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang;
            
            const translated = await translateText(text, sourceLangName, targetLangName, geminiKey || undefined);
            
            setTranslation(prev => [...prev, translated]);

            if (mode === 'dubbing' && !translated.startsWith('[')) {
              const voiceCode = LANGUAGES.find(l => l.code === targetLang)?.voiceCode || 'en-US';
              speak(translated, voiceCode);
              setIsPlaying(true);
            }
          } catch (e: any) {
            console.error('❌ [App] Translation failed:', e);
            const msg = e?.message || 'Translation Error';
            setTranslation(prev => [...prev, `[${msg}]`]);
          } finally {
            setIsTranslating(false);
          }
        })();
      } else {
        setTranslation(prev => [...prev, '[Translation unavailable: Gemini API Key missing]']);
      }
    }
  };

  const handlePauseSession = () => {
    if (speechServiceRef.current) {
      speechServiceRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleResumeSession = () => {
    if (speechServiceRef.current) {
      speechServiceRef.current.resume();
      setIsPaused(false);
    }
  };

  const handleClearSession = () => {
    setTranscript([]);
    setTranslation([]);
    setSessionTime(0);
    setDetectedLang(null);
  };

  const handleTestGemini = async () => {
    setTestStatus('testing');
    setTestError(null);
    try {
      const response = await fetch('/api/test-gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: geminiKey })
      });
      const data = await response.json();
      if (data.success) {
        setTestStatus('success');
        setTimeout(() => setTestStatus('idle'), 3000);
      } else {
        setTestStatus('error');
        setTestError(data.error || 'Connection failed');
      }
    } catch (e: any) {
      setTestStatus('error');
      setTestError(e.message || 'Network error');
    }
  };

  const handleStopSession = () => {
    if (speechServiceRef.current) {
      speechServiceRef.current.stop();
    }
    setStatus('idle');
    setIsPaused(false);
    stopSpeaking();
    setIsPlaying(false);
    setIsMicActive(false);
    setVolume(0);
    setDetectedLang(null);
  };

  const handleStartSession = async () => {
    console.log('🚀 [App] Starting session...');
    setError(null);
    setVolume(0);
    setIsMicActive(false);
    setIsPaused(false);
    
    // Unlock speech synthesis on user interaction
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const unlockUtterance = new SpeechSynthesisUtterance('');
      unlockUtterance.volume = 0;
      window.speechSynthesis.speak(unlockUtterance);
    }
    
    try {
      if (status === 'idle' || status === 'error') {
        // Ensure we have the speech service initialized
        if (!speechServiceRef.current) {
          console.log('🛠️ [App] Initializing Speech Service...');
          await initSpeechService(sourceLang, autoDetect);
        }

        if (speechServiceRef.current) {
          console.log('🎤 [App] Triggering speech service start...');
          // The start() method now strictly waits for audio before opening WS
          await speechServiceRef.current.start();
          setIsMicActive(true);
          console.log('✅ [App] Speech service session active');
        }
      }
    } catch (e) {
      console.error('❌ [App] Failed to start session:', e);
      setError(e instanceof Error ? e.message : 'Failed to start transcription');
      setStatus('error');
      setIsMicActive(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopyStatus(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setCopyStatus(prev => ({ ...prev, [key]: false }));
    }, 2000);
  };

  const initSpeechService = async (lang: string, detect: boolean) => {
    // Fetch fresh config to get the key
    const res = await fetch('/api/config');
    const config = await res.json();
    const dgKey = config.deepgramApiKey;
    
    const options = {
      language: lang,
      detectLanguage: detect,
      onTranscript: (result: any) => {
        processNewTranscript(result);
      },
      onStatusChange: (s: any) => {
        setStatus(s);
      },
      onError: (err: any) => {
        setError(err);
        setStatus('error');
      },
      onVolumeChange: (v: any) => {
        setVolume(v);
      },
      onDebugUpdate: (info: any) => {
        setDebugInfo(info);
      }
    };

    if (!dgKey) {
      console.warn('⚠️ [App] Deepgram API Key is missing. Falling back to Browser Speech Recognition.');
      speechServiceRef.current = new BrowserSpeechService(options) as any;
      return;
    }
    
    speechServiceRef.current = new DeepgramSpeechService({
      ...options,
      apiKey: dgKey,
    });
  };

  const swapLanguages = () => {
    const temp = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(temp);
    if (speechServiceRef.current) {
      speechServiceRef.current.stop();
      speechServiceRef.current = null;
      setStatus('idle');
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* API Configuration Modal */}
      <AnimatePresence>
        {showConfigModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-brand/10 rounded-xl">
                    <Settings className="w-5 h-5 text-brand" />
                  </div>
                  <h2 className="text-xl font-bold text-white">API Configuration</h2>
                </div>
                <button 
                  onClick={() => setShowConfigModal(false)}
                  className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Gemini Status */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm font-bold text-slate-300">Gemini AI (Translation)</span>
                    </div>
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${hasGeminiKey || geminiKey ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                      {hasGeminiKey || geminiKey ? 'Configured' : 'Missing'}
                    </div>
                  </div>
                  <div className="relative">
                    <input 
                      type="password"
                      value={geminiKey || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGeminiKey(val);
                        setIsGeminiActive(!!val || hasGeminiKey);
                      }}
                      placeholder="Enter Gemini API Key..."
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand/50 transition-all"
                    />
                    <Key className="absolute right-4 top-3.5 w-4 h-4 text-slate-600" />
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Used for high-speed real-time translation. If not provided, translation features will be disabled.
                  </p>
                  <button 
                    onClick={handleTestGemini}
                    disabled={testStatus === 'testing' || (!geminiKey && !hasGeminiKey)}
                    className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-all ${
                      testStatus === 'success' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                      testStatus === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                      'bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700'
                    }`}
                  >
                    {testStatus === 'testing' ? 'Testing...' : 
                     testStatus === 'success' ? 'Connection OK!' : 
                     testStatus === 'error' ? 'Test Failed' : 'Test Connection'}
                  </button>
                  {testError && <p className="text-[10px] text-red-500 mt-1">{testError}</p>}
                </div>

                {/* Deepgram Status */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4 text-brand" />
                      <span className="text-sm font-bold text-slate-300">Deepgram (Transcription)</span>
                    </div>
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${hasDeepgramKey ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                      {hasDeepgramKey ? 'Configured' : 'Fallback Active'}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    {hasDeepgramKey 
                      ? "Using high-performance Deepgram transcription." 
                      : "Deepgram key missing. Using browser-native speech recognition as fallback."}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <button 
                    onClick={() => setShowConfigModal(false)}
                    className="w-full py-3 bg-brand hover:bg-brand-dark text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-brand/20"
                  >
                    Save & Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center shadow-lg shadow-brand/20">
            <Shield className="text-white w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">InterpShield</h1>
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-widest">Enterprise AI Interpretation</p>
          </div>
        </div>
        
        <nav className="hidden md:flex items-center gap-8">
          <a href="#" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Dashboard</a>
          <a href="#" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">History</a>
          <a href="#" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Settings</a>
        </nav>

        <div className="flex items-center gap-3">
          <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all">
            <Share2 className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 overflow-hidden">
            <img src="https://picsum.photos/seed/user/32/32" alt="Avatar" referrerPolicy="no-referrer" />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 md:py-12">
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-sm"
          >
            <AlertCircle className="w-5 h-5" />
            <div className="flex-1">{error}</div>
            <button 
              onClick={() => { setError(null); setStatus('idle'); }}
              className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs font-bold"
            >
              Reset
            </button>
          </motion.div>
        )}

        {/* Silence Warning */}
        {status === 'listening' && !isPaused && debugInfo && debugInfo.lastChunkTimestamp > 0 && (currentTime - debugInfo.lastChunkTimestamp > 2000) && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3 text-amber-500 text-sm"
          >
            <VolumeX className="w-5 h-5" />
            <div>
              <p className="font-bold">Silence Detected</p>
              <p className="text-xs opacity-80">No audio data sent for {((currentTime - debugInfo.lastChunkTimestamp) / 1000).toFixed(1)}s. Check your microphone.</p>
            </div>
          </motion.div>
        )}

        {/* Main Panel */}
        <div className="glass-panel overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex p-1.5 bg-slate-900/80 border-b border-slate-800">
            <button 
              onClick={() => { setMode('transcribe'); stopSpeaking(); setIsPlaying(false); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${mode === 'transcribe' ? 'tab-active' : 'tab-inactive'}`}
            >
              <Mic className="w-4 h-4" />
              Transcribe
            </button>
            <button 
              onClick={() => { setMode('translate'); stopSpeaking(); setIsPlaying(false); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${mode === 'translate' ? 'tab-active' : 'tab-inactive'}`}
            >
              <Globe className="w-4 h-4" />
              Translate
            </button>
            <button 
              onClick={() => { setMode('dubbing'); stopSpeaking(); setIsPlaying(false); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${mode === 'dubbing' ? 'tab-active' : 'tab-inactive'}`}
            >
              <Volume2 className="w-4 h-4" />
              Dubbing
            </button>
          </div>

          <div className="p-6 md:p-8 space-y-8">
            {/* Language Selection & Toggles */}
            <div className="flex flex-col lg:flex-row gap-8 items-start">
              <div className="flex-1 w-full flex flex-col sm:flex-row items-center gap-4">
                <LanguageSelector 
                  label="Source Language" 
                  value={sourceLang} 
                  onChange={(val) => {
                    setSourceLang(val);
                    if (speechServiceRef.current) {
                      speechServiceRef.current.stop();
                      speechServiceRef.current = null;
                      setStatus('idle');
                    }
                  }} 
                />
                <button 
                  onClick={swapLanguages}
                  className="mt-6 p-2.5 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-all border border-slate-700"
                >
                  <ArrowRightLeft className="w-5 h-5" />
                </button>
                <LanguageSelector 
                  label="Target Language" 
                  value={targetLang} 
                  onChange={setTargetLang} 
                />
              </div>

              <div className="flex flex-wrap gap-3 pt-6 lg:pt-0">
                <Toggle 
                  label="Auto-detect" 
                  active={autoDetect} 
                  onClick={() => {
                    setAutoDetect(!autoDetect);
                    if (speechServiceRef.current) {
                      speechServiceRef.current.stop();
                      speechServiceRef.current = null;
                      setStatus('idle');
                    }
                  }} 
                  icon={RefreshCw}
                />
                <Toggle 
                  label="Two-Way" 
                  active={isTwoWay} 
                  onClick={() => setIsTwoWay(!isTwoWay)} 
                  icon={Languages}
                />
                <Toggle 
                  label={isPrivate ? "Private" : "Shareable"} 
                  active={!isPrivate} 
                  onClick={() => setIsPrivate(!isPrivate)} 
                  icon={isPrivate ? Lock : Share2}
                />
                <button 
                  onClick={() => setShowConfigModal(true)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl border border-slate-700 transition-all"
                  title="API Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Share Link Area */}
            {!isPrivate && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-brand/5 border border-brand/20 rounded-xl flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Share2 className="w-4 h-4 text-brand" />
                  <span className="text-sm font-mono text-brand/80">interpshield.io/session/x92k-p12m</span>
                </div>
                <button className="text-xs font-bold text-brand uppercase tracking-wider hover:underline">Copy Link</button>
              </motion.div>
            )}

            {/* Main Action Area */}
            <div className="flex flex-col items-center justify-center py-6 space-y-8">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <AnimatePresence>
                    {status === 'listening' && !isPaused && (
                      <motion.div 
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1.5, opacity: 0.3 }}
                        exit={{ scale: 2, opacity: 0 }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className="absolute inset-0 bg-brand rounded-full pulse-ring"
                      />
                    )}
                  </AnimatePresence>
                  
                  <button 
                    onClick={status === 'listening' ? (isPaused ? handleResumeSession : handlePauseSession) : handleStartSession}
                    disabled={status === 'requesting_permission'}
                    className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl ${
                      status === 'listening'
                        ? isPaused 
                          ? 'bg-amber-500 shadow-amber-500/40 hover:scale-105' 
                          : 'bg-red-500 shadow-red-500/40 hover:scale-105'
                        : 'bg-brand shadow-brand/40 hover:scale-105 active:scale-95'
                    }`}
                  >
                    {status === 'listening' ? (
                      isPaused ? <Play className="w-10 h-10 text-white ml-1" /> : <Pause className="w-10 h-10 text-white" />
                    ) : (
                      <Mic className="w-10 h-10 text-white" />
                    )}
                  </button>
                </div>

                {/* Session Timer */}
                <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/50 border border-slate-800 rounded-full">
                  <Timer className={`w-4 h-4 ${status === 'listening' && !isPaused ? 'text-brand animate-pulse' : 'text-slate-500'}`} />
                  <span className="text-lg font-mono font-bold text-white tabular-nums">
                    {formatTime(sessionTime)}
                  </span>
                </div>
              </div>

              <div className="text-center w-full max-w-sm">
                <h3 className="text-lg font-semibold text-white">
                  {status === 'idle' ? 'Ready to Start' : 
                   status === 'requesting_permission' ? 'Requesting Permission...' :
                   status === 'listening' ? (isPaused ? 'Session Paused' : 'Listening...') : 
                   status === 'processing' ? 'Translating...' : 
                   status === 'error' ? 'Session Error' :
                   'Speaking...'}
                </h3>
                
                {status === 'listening' && !isPaused && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-700">
                      <motion.div 
                        className="h-full bg-brand"
                        initial={{ width: 0 }}
                        animate={{ width: `${volume}%` }}
                        transition={{ type: 'spring', bounce: 0, duration: 0.1 }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                      Audio Input Level
                    </span>
                  </div>
                )}

                <p className="text-sm text-slate-500 mt-2">
                  {status === 'idle' 
                    ? 'Click the microphone to begin live interpretation' 
                    : status === 'requesting_permission'
                      ? 'Please allow microphone access in your browser'
                      : status === 'listening' 
                        ? (isPaused ? 'Session is paused. Click play to resume.' : 'Audio is being captured and processed in real-time')
                          : status === 'error'
                            ? 'There was an issue starting the session. Check console for details.'
                            : 'Processing AI translation...'}
                </p>
              </div>

              {/* Session Controls */}
              <div className="flex items-center gap-4">
                {status === 'listening' && (
                  <button 
                    onClick={handleStopSession}
                    className="flex items-center gap-2 px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold transition-all border border-slate-700"
                  >
                    <MicOff className="w-4 h-4" />
                    Stop Session
                  </button>
                )}
                
                {(transcript.length > 0 || translation.length > 0) && (
                  <button 
                    onClick={handleClearSession}
                    className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-sm font-bold transition-all border border-slate-800"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear All
                  </button>
                )}
              </div>

              {/* Status Indicator */}
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/50 rounded-full border border-slate-700">
                    <div className={`w-2 h-2 rounded-full ${status === 'listening' ? (isPaused ? 'bg-amber-500' : 'bg-red-500 animate-pulse') : 'bg-slate-600'}`} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      {status === 'listening' ? (isPaused ? 'Session Paused' : 'Session Active') : 'System Idle'}
                    </span>
                  </div>

                  {isGeminiActive && (
                    <motion.div 
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20"
                    >
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                        Gemini AI Active
                      </span>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>

            {/* Output Panels */}
            <div className={`grid grid-cols-1 ${mode === 'transcribe' ? 'md:grid-cols-1 max-w-3xl mx-auto w-full' : 'md:grid-cols-2'} gap-6 transition-all duration-500`}>
              {/* Transcript Panel */}
              <div className={`flex flex-col h-[400px] bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden shadow-inner transition-all duration-500 ${mode === 'transcribe' ? 'border-brand/30' : ''}`}>
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Live Transcript</span>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-brand/10 rounded-full border border-brand/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                      <span className="text-[10px] font-bold text-brand uppercase tracking-tight">
                        {autoDetect 
                          ? (detectedLang ? `Detected: ${LANGUAGES.find(l => l.code === detectedLang)?.name || detectedLang}` : 'Auto-Detecting...') 
                          : (LANGUAGES.find(l => l.code === sourceLang)?.name || sourceLang)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => copyToClipboard(transcript.join('\n'), 'transcript')}
                      className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                      title="Copy Transcript"
                    >
                      {copyStatus['transcript'] ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button 
                      onClick={() => setTranscript([])}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all"
                      title="Clear Transcript"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 p-6 overflow-y-auto space-y-4 scrollbar-hide bg-slate-950/20">
                  {transcript.length === 0 && !interimTranscript && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 italic text-sm space-y-2">
                      <Mic className="w-8 h-8 opacity-20" />
                      <p>Waiting for speech...</p>
                    </div>
                  )}
                  {transcript.map((text, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-slate-800/30 rounded-2xl border border-slate-700/50 text-sm leading-relaxed text-slate-200 shadow-sm"
                    >
                      {text}
                    </motion.div>
                  ))}
                  
                  {interimTranscript && (
                    <motion.div 
                      initial={{ opacity: 0.5 }}
                      animate={{ opacity: 1 }}
                      className="p-4 bg-brand/5 rounded-2xl border border-brand/10 text-sm leading-relaxed italic text-slate-400"
                    >
                      {interimTranscript}
                      <span className="inline-block w-1.5 h-4 bg-brand ml-1 animate-pulse rounded-full" />
                    </motion.div>
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </div>

              {/* Translation Panel */}
              {mode !== 'transcribe' && (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex flex-col h-[400px] bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden shadow-inner"
                >
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Translated Output</span>
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tight">
                          {LANGUAGES.find(l => l.code === targetLang)?.name || targetLang}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => copyToClipboard(translation.join('\n'), 'translation')}
                        className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                        title="Copy Translation"
                      >
                        {copyStatus['translation'] ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button 
                        onClick={() => setTranslation([])}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all"
                        title="Clear Translation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 p-6 overflow-y-auto space-y-4 scrollbar-hide bg-slate-950/20">
                    {translation.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-slate-600 italic text-sm text-center px-4 space-y-2">
                        <Globe className="w-8 h-8 opacity-20" />
                        <p>
                          {!(hasGeminiKey || !!geminiKey) && (mode === 'translate' || mode === 'dubbing') 
                            ? "Translation unavailable until Gemini API Key is configured."
                            : "Translation will appear here..."}
                        </p>
                      </div>
                    )}
                    {translation.map((text, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`p-4 rounded-2xl border text-sm leading-relaxed shadow-sm ${
                          text.startsWith('[') 
                            ? 'bg-amber-500/5 border-amber-500/20 text-amber-500/80 italic' 
                            : 'bg-brand/5 border-brand/10 text-brand-light'
                        }`}
                      >
                        {text}
                      </motion.div>
                    ))}
                    
                    {isTranslating && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 text-sm leading-relaxed italic text-emerald-500/60 flex items-center gap-2"
                      >
                        <Sparkles className="w-3 h-3 animate-pulse" />
                        AI is translating...
                      </motion.div>
                    )}
                    <div ref={translationEndRef} />
                  </div>
                </motion.div>
              )}
            </div>

            {/* Dubbing Mode Area */}
            {mode === 'dubbing' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-6 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Generated Voice Output</span>
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-slate-500 hover:text-slate-300 cursor-pointer" />
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        if (isPlaying) {
                          stopSpeaking();
                          setIsPlaying(false);
                        } else if (translation.length > 0) {
                          const voiceCode = LANGUAGES.find(l => l.code === targetLang)?.voiceCode || 'en-US';
                          speak(translation[translation.length - 1], voiceCode);
                          setIsPlaying(true);
                        }
                      }}
                      className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition-all"
                      title={isPlaying ? "Pause Dubbing" : "Play Latest Translation"}
                    >
                      {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
                    </button>

                    <button 
                      onClick={() => {
                        stopSpeaking();
                        setIsPlaying(false);
                      }}
                      className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white border border-slate-700 transition-all"
                      title="Stop Dubbing"
                    >
                      <VolumeX className="w-5 h-5" />
                    </button>

                    <button 
                      onClick={() => {
                        if (translation.length > 0) {
                          stopSpeaking();
                          const voiceCode = LANGUAGES.find(l => l.code === targetLang)?.voiceCode || 'en-US';
                          speak(translation[translation.length - 1], voiceCode);
                          setIsPlaying(true);
                        }
                      }}
                      className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white border border-slate-700 transition-all"
                      title="Replay Latest"
                    >
                      <RotateCcw className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="flex-1 h-12 flex items-center gap-1">
                    {[...Array(40)].map((_, i) => (
                      <motion.div 
                        key={i}
                        animate={{ 
                          height: isPlaying ? [8, Math.random() * 32 + 8, 8] : 8 
                        }}
                        transition={{ 
                          repeat: Infinity, 
                          duration: 0.5 + Math.random(),
                          ease: "easeInOut"
                        }}
                        className={`w-1 rounded-full ${isPlaying ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      />
                    ))}
                  </div>

                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Latency</p>
                    <p className="text-sm font-mono text-emerald-500">120ms</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Health Monitor (Dev Only) */}
            {debugInfo && (
              <div className="p-4 bg-slate-900/30 border border-slate-800 rounded-xl space-y-3 mt-6">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Connection Health Monitor</h4>
                  <div className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${debugInfo.socketConnected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    {debugInfo.socketConnected ? 'Deepgram Connected' : 'Deepgram Disconnected'}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <p className="text-[8px] text-slate-500 uppercase font-bold">Chunks Sent</p>
                    <p className="text-xs font-mono text-white">{debugInfo.chunksSent}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] text-slate-500 uppercase font-bold">Silence</p>
                    <p className="text-xs font-mono text-white">
                      {debugInfo.lastChunkTimestamp > 0 ? `${((currentTime - debugInfo.lastChunkTimestamp) / 1000).toFixed(1)}s` : 'N/A'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] text-slate-500 uppercase font-bold">Last Transcript</p>
                    <p className="text-xs font-mono text-white">
                      {debugInfo.lastTranscriptTimestamp > 0 ? `${((currentTime - debugInfo.lastTranscriptTimestamp) / 1000).toFixed(1)}s ago` : 'N/A'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] text-slate-500 uppercase font-bold">Latency</p>
                    <p className="text-xs font-mono text-white">{debugInfo.metrics?.connectionLatency || 0}ms</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* How it Works Section */}
        <section className="mt-20 space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold text-white">How InterpShield Works</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Our enterprise-grade AI engine processes audio with sub-second latency to provide seamless communication.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { 
                step: "01", 
                title: "Select Languages", 
                desc: "Choose from over 80 supported languages and dialects for source and target.",
                icon: Globe
              },
              { 
                step: "02", 
                title: "Start Session", 
                desc: "Click the microphone to begin capturing audio. Our engine starts processing instantly.",
                icon: Mic
              },
              { 
                step: "03", 
                title: "Receive Live Translation", 
                desc: "View real-time transcripts and translations, or listen to high-quality dubbed audio.",
                icon: Volume2
              }
            ].map((item, i) => (
              <div key={i} className="glass-panel p-8 space-y-4 relative group hover:border-brand/30 transition-all">
                <div className="absolute top-4 right-6 text-4xl font-black text-slate-800/30 group-hover:text-brand/10 transition-colors">{item.step}</div>
                <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center text-brand">
                  <item.icon className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-bold text-white">{item.title}</h4>
                <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto px-6 py-8 border-t border-slate-900 bg-slate-950">
        <div className="max-w-6xl w-full mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand" />
            <span className="font-bold text-white">InterpShield</span>
            <span className="text-slate-600 ml-2">© {new Date().getFullYear()}</span>
          </div>
          
          <div className="flex items-center gap-8">
            <a href="#" className="text-xs font-medium text-slate-500 hover:text-slate-300">Privacy Policy</a>
            <a href="#" className="text-xs font-medium text-slate-500 hover:text-slate-300">Terms of Service</a>
            <a href="#" className="text-xs font-medium text-slate-500 hover:text-slate-300">Support</a>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
              <div className="w-1 h-1 rounded-full bg-emerald-500" />
              All Systems Operational
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
