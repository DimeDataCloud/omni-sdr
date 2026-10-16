import React, { useState } from 'react';
import { 
  Play,
  Wand2,
  Image as ImageIcon,
  Video,
  Music,
  Settings2,
  Clock,
  Layers,
  Download,
  Share2,
  Maximize2,
  Type,
  Mic,
  Scissors,
  Plus,
  Sparkles
} from 'lucide-react';
import { Agent } from '../ui-types';

interface StudioViewProps {
  agents: Agent[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
}

export const StudioView: React.FC<StudioViewProps> = () => {
  const [prompt, setPrompt] = useState('A sleek, high-end professional marketing video frame showing a modern abstract 3D visualization of data flowing into a glowing central core, dark mode, cinematic lighting, neon accents, highly detailed.');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [generationType, setGenerationType] = useState('text-to-video');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => setIsGenerating(false), 3000);
  };

  return (
    <div className="flex-1 bg-[#0a0a0a] text-white overflow-hidden flex flex-col font-sans h-full">
      
      {/* Studio Header */}
      <div className="h-14 border-b border-[#222] flex items-center justify-between px-6 shrink-0 bg-[#111]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#a3ffb1] to-[#036d30] flex items-center justify-center">
            <Wand2 className="w-4 h-4 text-[#111]" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">Omni Creator Studio</h1>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">AI Video & Asset Generation</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="p-2 hover:bg-[#222] rounded-lg transition-colors text-gray-400 hover:text-white">
            <Share2 className="w-4 h-4" />
          </button>
          <button className="flex items-center gap-2 px-4 py-1.5 bg-[#222] hover:bg-[#333] border border-[#333] text-sm font-medium rounded-lg transition-colors">
            <Download className="w-4 h-4" />
            Export HD
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar: Controls */}
        <div className="w-80 border-r border-[#222] bg-[#111] overflow-y-auto flex flex-col hide-scrollbar">
          <div className="p-5 space-y-6">
            
            {/* Generation Type */}
            <div className="space-y-3">
              <label className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'text-to-video', icon: <Type className="w-4 h-4 mb-1" />, label: 'Text' },
                  { id: 'image-to-video', icon: <ImageIcon className="w-4 h-4 mb-1" />, label: 'Image' },
                  { id: 'video-to-video', icon: <Video className="w-4 h-4 mb-1" />, label: 'Video' }
                ].map(type => (
                  <button
                    key={type.id}
                    onClick={() => setGenerationType(type.id)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs transition-all ${
                      generationType === type.id
                        ? 'bg-[#a3ffb1]/10 border-[#a3ffb1] text-[#a3ffb1]'
                        : 'bg-[#1a1a1a] border-[#333] text-gray-400 hover:bg-[#222]'
                    }`}
                  >
                    {type.icon}
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt Area */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">Prompt</label>
                <button className="text-[10px] text-[#a3ffb1] hover:underline flex items-center gap-1">
                  <Wand2 className="w-3 h-3" /> Enhance
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl p-3 text-sm text-gray-200 focus:outline-none focus:border-[#a3ffb1] resize-none"
                placeholder="Describe your scene..."
              />
            </div>

            {/* Configuration Settings */}
            <div className="space-y-4">
              <label className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5" /> Settings
              </label>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Aspect Ratio</span>
                  <select 
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="bg-[#1a1a1a] border border-[#333] text-xs text-white rounded-lg px-2 py-1 outline-none focus:border-[#a3ffb1]"
                  >
                    <option value="16:9">16:9 (Landscape)</option>
                    <option value="9:16">9:16 (Vertical)</option>
                    <option value="1:1">1:1 (Square)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Duration</span>
                  <select className="bg-[#1a1a1a] border border-[#333] text-xs text-white rounded-lg px-2 py-1 outline-none focus:border-[#a3ffb1]">
                    <option>5 seconds</option>
                    <option>10 seconds</option>
                    <option>15 seconds</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Camera Motion</span>
                  <select className="bg-[#1a1a1a] border border-[#333] text-xs text-white rounded-lg px-2 py-1 outline-none focus:border-[#a3ffb1]">
                    <option>Dynamic Push</option>
                    <option>Slow Pan Right</option>
                    <option>Orbit</option>
                    <option>Static</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <div className="pt-4 mt-4 border-t border-[#333]">
              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full py-3 bg-[#a3ffb1] hover:bg-[#8cf29c] text-[#111] font-bold text-sm rounded-xl shadow-[0_0_15px_rgba(163,255,177,0.3)] transition-all flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <span className="animate-pulse">Generating Scene...</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Video (12 Credits)
                  </>
                )}
              </button>
            </div>

          </div>
        </div>

        {/* Main Canvas & Timeline */}
        <div className="flex-1 flex flex-col bg-[#0a0a0a]">
          
          {/* Canvas Area */}
          <div className="flex-1 p-6 flex items-center justify-center relative overflow-hidden">
            {/* Grid Background Pattern */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none mix-blend-overlay"></div>
            
            {/* The Player */}
            <div className={`relative w-full max-w-4xl aspect-video bg-black rounded-2xl border border-[#333] shadow-2xl overflow-hidden group transition-all duration-500 ${isGenerating ? 'opacity-50 blur-sm scale-95' : 'opacity-100 scale-100'}`}>
              
              <img 
                src="/studio-preview.jpg" 
                alt="Video Preview" 
                className="w-full h-full object-cover"
              />

              {/* Player Overlay Controls */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                <div className="flex items-center gap-4">
                  <button className="w-10 h-10 rounded-full bg-[#a3ffb1] text-black flex items-center justify-center hover:scale-105 transition-transform shadow-lg">
                    <Play className="w-5 h-5 ml-1" />
                  </button>
                  
                  {/* Scrubber */}
                  <div className="flex-1 flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-300">00:02</span>
                    <div className="h-1.5 flex-1 bg-white/20 rounded-full overflow-hidden cursor-pointer relative">
                      <div className="absolute left-0 top-0 bottom-0 w-[40%] bg-[#a3ffb1]"></div>
                    </div>
                    <span className="text-xs font-mono text-gray-300">00:05</span>
                  </div>

                  <button className="text-white/70 hover:text-white transition-colors">
                    <Maximize2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Generation Overlay */}
              {isGenerating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                  <div className="w-12 h-12 border-4 border-[#333] border-t-[#a3ffb1] rounded-full animate-spin mb-4"></div>
                  <p className="text-[#a3ffb1] font-mono text-sm tracking-widest uppercase animate-pulse">Rendering Frames...</p>
                </div>
              )}
            </div>
          </div>

          {/* Timeline / Storyboard (Bottom) */}
          <div className="h-64 border-t border-[#222] bg-[#111] flex flex-col shrink-0">
            <div className="h-10 border-b border-[#222] flex items-center justify-between px-4">
              <div className="flex items-center gap-4">
                <button className="text-xs font-bold text-white border-b-2 border-[#a3ffb1] h-10 px-2 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5" /> Timeline
                </button>
                <button className="text-xs font-medium text-gray-500 hover:text-gray-300 h-10 px-2 flex items-center gap-2">
                  <ImageIcon className="w-3.5 h-3.5" /> Assets
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-1.5 text-gray-400 hover:text-white rounded bg-[#222]">
                  <Scissors className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-[#333] mx-1"></div>
                <button className="text-xs font-mono text-gray-400 hover:text-white">Fit</button>
              </div>
            </div>

            {/* Timeline Tracks */}
            <div className="flex-1 overflow-x-auto p-4 space-y-2 relative hide-scrollbar">
              {/* Playhead */}
              <div className="absolute top-0 bottom-0 left-[200px] w-0.5 bg-[#a3ffb1] z-20 shadow-[0_0_8px_#a3ffb1]">
                <div className="absolute -top-1 -left-1.5 w-3.5 h-3.5 bg-[#a3ffb1] rounded-sm"></div>
              </div>

              {/* Track 1: Video */}
              <div className="flex items-center gap-2">
                <div className="w-20 shrink-0 flex items-center gap-2 text-[10px] text-gray-500 font-mono uppercase">
                  <Video className="w-3 h-3" /> V1
                </div>
                <div className="flex-1 h-16 bg-[#1a1a1a] rounded-lg border border-[#333] flex items-center p-1 gap-1 relative overflow-hidden">
                  {/* Clip 1 */}
                  <div className="h-full w-48 bg-[#2a2a2a] rounded border border-[#444] p-1 flex relative group">
                    <img src="/studio-preview.jpg" className="h-full aspect-video object-cover rounded-sm opacity-50" />
                    <span className="absolute bottom-1 right-1 text-[8px] bg-black/50 px-1 rounded font-mono text-white">00:05</span>
                  </div>
                  {/* Add Clip Button */}
                  <button className="h-full w-12 rounded border border-dashed border-[#444] flex items-center justify-center text-[#444] hover:text-[#a3ffb1] hover:border-[#a3ffb1] transition-colors">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Track 2: Audio/Voiceover */}
              <div className="flex items-center gap-2">
                <div className="w-20 shrink-0 flex items-center gap-2 text-[10px] text-gray-500 font-mono uppercase">
                  <Mic className="w-3 h-3" /> A1
                </div>
                <div className="flex-1 h-12 bg-[#1a1a1a] rounded-lg border border-[#333] flex items-center p-1 gap-1">
                  {/* Voiceover Clip */}
                  <div className="h-full w-48 bg-[#036d30]/30 rounded border border-[#036d30] p-1 flex items-center relative overflow-hidden">
                    {/* Fake waveform */}
                    <svg className="w-full h-full text-[#a3ffb1] opacity-50" preserveAspectRatio="none" viewBox="0 0 100 20">
                      <path d="M0 10 Q 5 2 10 10 T 20 10 T 30 10 T 40 10 T 50 10 T 60 10 T 70 10 T 80 10 T 90 10 T 100 10" fill="none" stroke="currentColor" strokeWidth="1" />
                      <path d="M0 10 Q 5 18 10 10 T 20 10 T 30 10 T 40 10 T 50 10 T 60 10 T 70 10 T 80 10 T 90 10 T 100 10" fill="none" stroke="currentColor" strokeWidth="1" />
                    </svg>
                    <span className="absolute top-1 left-1 text-[8px] font-mono text-[#a3ffb1]">AI Voice: Sarah</span>
                  </div>
                </div>
              </div>

              {/* Track 3: BGM */}
              <div className="flex items-center gap-2">
                <div className="w-20 shrink-0 flex items-center gap-2 text-[10px] text-gray-500 font-mono uppercase">
                  <Music className="w-3 h-3" /> A2
                </div>
                <div className="flex-1 h-10 bg-[#1a1a1a] rounded-lg border border-[#333] flex items-center p-1 gap-1">
                  <div className="h-full w-full bg-[#333]/50 rounded border border-[#444] p-1 flex items-center relative overflow-hidden">
                    <span className="absolute top-1 left-1 text-[8px] font-mono text-gray-400">Ambient Corporate BGM.mp3</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
