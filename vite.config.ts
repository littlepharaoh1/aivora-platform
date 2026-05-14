import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 3000 },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'vendor-react': ['react', 'react-dom'],

          // Supabase
          'vendor-supabase': ['@supabase/supabase-js'],

          // Lucide icons
          'vendor-icons': ['lucide-react'],

          // DSP Engine (merged to avoid circular deps)
          'dsp-engine': [
            './src/lib/audioQc/audioAnalyzerCore',
            './src/lib/audioQc/lufsAnalyzer',
            './src/lib/audioQc/fftAnalyzer',
            './src/lib/audioQc/snrAnalyzer',
            './src/lib/audioQc/vadAnalyzer',
            './src/lib/audioQc/advancedVAD',
            './src/lib/audioQc/reverbDetector',
            './src/lib/audioQc/appenScore',
          ],

          // DSP Runtime
          'dsp-runtime': [
            './src/lib/dsp/metricGuards',
            './src/lib/dsp/runtime/dspRuntime',
            './src/lib/dsp/queue/dspQueue',
            './src/lib/dsp/streaming/longAudioProcessor',
          ],

          // Repair Suite
          'repair-suite': [
            './src/lib/audioQc/repair/noiseReducer',
            './src/lib/audioQc/repair/dynamicCompressor',
            './src/lib/audioQc/repair/multiBandEQ',
            './src/lib/audioQc/repair/humRemover',
            './src/lib/audioQc/repair/loudnessNormalizer',
            './src/lib/audioQc/repair/silenceTrimmer',
            './src/lib/audioQc/repair/repairPipeline',
          ],

          // Waveform Editor
          'waveform-editor': [
            './src/lib/audioEditor/waveformRenderer',
            './src/lib/audioEditor/regionEditor',
            './src/lib/audioEditor/timeStretch',
            './src/lib/audioEditor/audioBufferUtils',
          ],

          // Speaker + Naming
          'speaker-naming': [
            './src/lib/audioQc/speakerVerifier',
            './src/lib/naming/germanSequencer',
            './src/lib/naming/zipExporter',
          ],

          // Auth + Tracking
          'auth-tracking': [
            './src/lib/auth/AuthContext',
            './src/lib/auth/permissions',
            './src/lib/auth/usePermissions',
            './src/lib/tracking/activityTracker',
          ],
        },
      },
    },
  },
})
