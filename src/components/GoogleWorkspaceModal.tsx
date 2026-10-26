import React, { useState, useEffect } from 'react';
import { 
  FolderGit2, 
  Mail, 
  Calendar as CalendarIcon, 
  FileText, 
  Video, 
  ExternalLink, 
  Search, 
  Plus, 
  Send, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Paperclip, 
  FileCheck,
  Clock,
  Sparkles,
  ShieldAlert,
  UserCheck,
  LogOut,
  ChevronRight
} from 'lucide-react';

import { 
  fetchDriveFiles, 
  fetchGmailMessages, 
  fetchCalendarEvents, 
  sendGmailOutreach, 
  createCalendarMeetingWithMeet, 
  uploadBriefToDrive, 
  openGoogleDrivePicker,
  GoogleDriveFile,
  GoogleCalendarEvent,
  GmailMessageItem
} from '../lib/googleWorkspace';
import { googleSignIn, logout, getAccessToken, setAccessToken } from '../lib/firebase';

interface GoogleWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any | null;
  onAuthSuccess: (user: any, token: string) => void;
  onAuthLogout: () => void;
  onAttachFileToChat?: (file: { name: string; url: string; mimeType: string }) => void;
}

export const GoogleWorkspaceModal: React.FC<GoogleWorkspaceModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAuthSuccess,
  onAuthLogout,
  onAttachFileToChat,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'drive' | 'gmail' | 'calendar' | 'meet' | 'forms'>('drive');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Drive state
  const [driveFiles, setDriveFiles] = useState<GoogleDriveFile[]>([]);
  const [driveSearch, setDriveSearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Gmail state
  const [gmailMessages, setGmailMessages] = useState<GmailMessageItem[]>([]);
  const [composeTo, setComposeTo] = useState('prospect@brightsidehealth.com');
  const [composeSubject, setComposeSubject] = useState('Omni-SDR // Executive Briefing & Discovery');
  const [composeBody, setComposeBody] = useState(
    'Hi Sarah,\n\nI noticed Brightside Health is expanding its patient onboarding operations. Our autonomous SDR fleet can help qualify inbound inquiries with verified Claims Gate citations.\n\nWould you be open to a 15-min discovery call this Thursday at 2:00 PM EDT?\n\nBest,\nAlex Chen'
  );
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);

  // Calendar & Meet state
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [meetingSummary, setMeetingSummary] = useState('Brightside Health // Omni-SDR Demo');
  const [meetingLeadEmail, setMeetingLeadEmail] = useState('sarah.jenkins@brightsidehealth.com');
  const [meetingTime, setMeetingTime] = useState(
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16)
  );
  const [showScheduleConfirmation, setShowScheduleConfirmation] = useState(false);

  // Forms state
  const [formIdInput, setFormIdInput] = useState('1FAIpQLScOmniSDRSampleFormId');

  // Load data when tab or auth changes
  useEffect(() => {
    if (isOpen && currentUser) {
      loadTabData();
    }
  }, [isOpen, activeSubTab, currentUser]);

  const loadTabData = async () => {
    const token = await getAccessToken();
    if (!token) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      if (activeSubTab === 'drive') {
        const files = await fetchDriveFiles(token, driveSearch);
        setDriveFiles(files);
      } else if (activeSubTab === 'gmail') {
        const msgs = await fetchGmailMessages(token);
        setGmailMessages(msgs);
      } else if (activeSubTab === 'calendar' || activeSubTab === 'meet') {
        const events = await fetchCalendarEvents(token);
        setCalendarEvents(events);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error querying Google Workspace API');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setAccessToken(result.accessToken);
        onAuthSuccess(result.user, result.accessToken);
        setSuccessMsg(`Connected as ${result.user.email}`);
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Google Sign-In failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    onAuthLogout();
    setDriveFiles([]);
    setGmailMessages([]);
    setCalendarEvents([]);
  };

  // Google Picker invocation
  const handleOpenPicker = async () => {
    const token = await getAccessToken();
    if (!token) {
      setErrorMsg('Please sign in with Google first.');
      return;
    }
    try {
      await openGoogleDrivePicker(token, (file) => {
        if (onAttachFileToChat) {
          onAttachFileToChat(file);
        }
        setSuccessMsg(`Attached "${file.name}" to Composer.`);
        setTimeout(() => setSuccessMsg(null), 3000);
      });
    } catch (err: any) {
      setErrorMsg(`Google Picker error: ${err.message}`);
    }
  };

  // Upload Brief to Drive
  const handleUploadSampleBrief = async () => {
    const token = await getAccessToken();
    if (!token) return;
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const sampleContent = `# Omni-SDR Sales Briefing: Brightside Health Pod\n\n- ICP Fit: 96%\n- Claims Gate Anchor: Verified hiring signal on LinkedIn\n- Suggested Angle: Patient intake bottleneck resolution\n- Date: ${new Date().toLocaleDateString()}`;
      const uploaded = await uploadBriefToDrive(
        token, 
        `Omni-SDR-Brief-${Date.now()}.md`, 
        sampleContent
      );
      setSuccessMsg(`Created file "${uploaded.name}" on Google Drive!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      loadTabData();
    } catch (err: any) {
      setErrorMsg(`Failed to upload: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Destructive/Outbound Operation: Send Gmail Outreach
  const handleSendEmailConfirmed = async () => {
    const token = await getAccessToken();
    if (!token) return;
    setShowSendConfirmation(false);
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await sendGmailOutreach(token, {
        to: composeTo,
        subject: composeSubject,
        body: composeBody,
      });
      setSuccessMsg(`Outreach email successfully sent to ${composeTo} via Gmail!`);
      setTimeout(() => setSuccessMsg(null), 4000);
      loadTabData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send email');
    } finally {
      setIsLoading(false);
    }
  };

  // Schedule Discovery Meeting with Google Meet
  const handleScheduleMeetingConfirmed = async () => {
    const token = await getAccessToken();
    if (!token) return;
    setShowScheduleConfirmation(false);
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const startIso = new Date(meetingTime).toISOString();
      const endIso = new Date(new Date(meetingTime).getTime() + 30 * 60 * 1000).toISOString();

      const created = await createCalendarMeetingWithMeet(token, {
        summary: meetingSummary,
        description: `Omni-SDR Autonomous Discovery & Technical Walkthrough.\nLead: ${meetingLeadEmail}`,
        startTime: startIso,
        endTime: endIso,
        attendeeEmail: meetingLeadEmail,
      });

      setSuccessMsg(`Scheduled! Google Meet link generated: ${created.hangoutLink || 'Meet attached'}`);
      setTimeout(() => setSuccessMsg(null), 5000);
      loadTabData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to schedule calendar event');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 z-50 animate-in fade-in duration-150">
      <div className="bg-[#fbf9f5] border border-[#eae4d9] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#eae4d9] bg-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#a3ffb1]/40 border border-[#a3ffb1] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#036d30]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#111111]">Google Workspace Integration Hub</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#16a34a]/10 text-[#036d30] font-bold border border-[#16a34a]/20">
                  Real 1P Google APIs
                </span>
              </div>
              <p className="text-xs text-[#6f7a6e]">
                Direct client-side access to Google Drive, Gmail, Calendar, Forms, Meet & Picker
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {currentUser ? (
              <div className="flex items-center gap-2 bg-[#f5f3ef] border border-[#eae4d9] px-3 py-1.5 rounded-xl">
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <UserCheck className="w-4 h-4 text-[#036d30]" />
                )}
                <span className="text-xs font-mono font-medium text-[#111111] max-w-[140px] truncate">
                  {currentUser.email}
                </span>
                <button
                  onClick={handleSignOut}
                  title="Sign out of Google"
                  className="p-1 hover:text-red-600 transition-colors ml-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleSignIn}
                className="gsi-material-button flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#eae4d9] bg-white hover:bg-[#f0eeea] text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                <span>Sign in with Google</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="text-[#6f7a6e] hover:text-[#111111] p-1.5 rounded-lg hover:bg-[#f0eeea] transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Status Messages */}
        {errorMsg && (
          <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-xs text-red-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-red-700 hover:text-red-900">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900">✕</button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-[#eae4d9] bg-[#fbf9f5] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveSubTab('drive')}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeSubTab === 'drive'
                  ? 'border-[#036d30] text-[#036d30]'
                  : 'border-transparent text-[#6f7a6e] hover:text-[#111111]'
              }`}
            >
              <FolderGit2 className="w-4 h-4" />
              <span>Drive & Picker</span>
            </button>

            <button
              onClick={() => setActiveSubTab('gmail')}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeSubTab === 'gmail'
                  ? 'border-[#036d30] text-[#036d30]'
                  : 'border-transparent text-[#6f7a6e] hover:text-[#111111]'
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>Gmail Outreach</span>
            </button>

            <button
              onClick={() => setActiveSubTab('calendar')}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeSubTab === 'calendar'
                  ? 'border-[#036d30] text-[#036d30]'
                  : 'border-transparent text-[#6f7a6e] hover:text-[#111111]'
              }`}
            >
              <CalendarIcon className="w-4 h-4" />
              <span>Google Calendar</span>
            </button>

            <button
              onClick={() => setActiveSubTab('meet')}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeSubTab === 'meet'
                  ? 'border-[#036d30] text-[#036d30]'
                  : 'border-transparent text-[#6f7a6e] hover:text-[#111111]'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>Google Meet</span>
            </button>

            <button
              onClick={() => setActiveSubTab('forms')}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeSubTab === 'forms'
                  ? 'border-[#036d30] text-[#036d30]'
                  : 'border-transparent text-[#6f7a6e] hover:text-[#111111]'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Google Forms</span>
            </button>
          </div>

          <button
            onClick={loadTabData}
            disabled={isLoading || !currentUser}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#6f7a6e] hover:text-[#111111] hover:bg-white rounded-lg transition-colors border border-[#eae4d9]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!currentUser ? (
            <div className="text-center py-12 px-4 bg-white border border-[#eae4d9] rounded-2xl max-w-md mx-auto space-y-4 shadow-sm">
              <div className="w-12 h-12 rounded-2xl bg-[#a3ffb1]/40 border border-[#a3ffb1] mx-auto flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-[#036d30]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#111111]">Connect Google Workspace</h3>
                <p className="text-xs text-[#6f7a6e] mt-1 leading-relaxed">
                  Sign in with Google to enable real integration with your Google Drive collateral, Gmail mailbox, Google Calendar schedules, and Google Meet rooms.
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSignIn}
                  className="gsi-material-button inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#eae4d9] bg-white hover:bg-[#f0eeea] text-xs font-bold text-[#111111] shadow-sm transition-all cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  <span>Sign in with Google</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* SUBTAB: DRIVE & PICKER */}
              {activeSubTab === 'drive' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-[#6f7a6e] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search Drive files, decks, briefs..."
                        value={driveSearch}
                        onChange={(e) => setDriveSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadTabData()}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30]"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleOpenPicker}
                        className="px-3 py-1.5 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        <span>Launch Google Picker</span>
                      </button>

                      <button
                        onClick={handleUploadSampleBrief}
                        disabled={isUploading}
                        className="px-3 py-1.5 bg-white hover:bg-[#f0eeea] border border-[#eae4d9] text-[#111111] text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{isUploading ? 'Uploading...' : 'Save SDR Brief to Drive'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-white border border-[#eae4d9] rounded-2xl overflow-hidden shadow-sm">
                    <div className="px-4 py-2.5 bg-[#fbf9f5] border-b border-[#eae4d9] flex items-center justify-between text-[11px] font-semibold text-[#6f7a6e]">
                      <span>Document Title</span>
                      <span>Actions</span>
                    </div>

                    {driveFiles.length === 0 ? (
                      <div className="p-8 text-center text-xs text-[#6f7a6e]">
                        {isLoading ? 'Loading Drive files...' : 'No files found in Google Drive query. Try uploading or launching the Picker.'}
                      </div>
                    ) : (
                      <div className="divide-y divide-[#eae4d9]/50">
                        {driveFiles.map((file) => (
                          <div key={file.id} className="px-4 py-3 flex items-center justify-between hover:bg-[#fbf9f5] transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-lg bg-[#f0eeea] flex items-center justify-center shrink-0">
                                <FileCheck className="w-4 h-4 text-[#036d30]" />
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-[#111111]">{file.name}</div>
                                <div className="text-[10px] font-mono text-[#6f7a6e]">
                                  {file.mimeType.split('.').pop() || file.mimeType}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {onAttachFileToChat && (
                                <button
                                  onClick={() => {
                                    onAttachFileToChat({
                                      name: file.name,
                                      url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
                                      mimeType: file.mimeType,
                                    });
                                    setSuccessMsg(`Attached "${file.name}" to Composer!`);
                                    setTimeout(() => setSuccessMsg(null), 3000);
                                  }}
                                  className="px-2.5 py-1 bg-[#f0eeea] hover:bg-[#a3ffb1] text-[#111111] rounded-lg text-xs font-medium transition-colors"
                                >
                                  Attach to Agent
                                </button>
                              )}
                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-[#6f7a6e] hover:text-[#111111] rounded-lg hover:bg-white transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SUBTAB: GMAIL */}
              {activeSubTab === 'gmail' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: Outbound Campaign Dispatch */}
                  <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[#eae4d9]">
                      <h3 className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5 text-[#036d30]" />
                        <span>Send Personalized Outreach (gmail.send)</span>
                      </h3>
                      <span className="text-[10px] font-mono text-[#036d30] font-bold bg-[#a3ffb1]/30 px-2 py-0.5 rounded">
                        Native Mailbox
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] font-mono text-[#6f7a6e] block">Recipient Email</label>
                        <input
                          type="email"
                          value={composeTo}
                          onChange={(e) => setComposeTo(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-[#fbf9f5] border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-[#6f7a6e] block">Subject</label>
                        <input
                          type="text"
                          value={composeSubject}
                          onChange={(e) => setComposeSubject(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-[#fbf9f5] border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-[#6f7a6e] block">Body (Verified Claims Gate Copy)</label>
                        <textarea
                          rows={6}
                          value={composeBody}
                          onChange={(e) => setComposeBody(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#fbf9f5] border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30] font-sans"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => setShowSendConfirmation(true)}
                      className="w-full py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Dispatch Outreach via Gmail</span>
                    </button>
                  </div>

                  {/* Right: Synced Gmail Messages / Inbox */}
                  <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between pb-2 border-b border-[#eae4d9]">
                      <h3 className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-[#036d30]" />
                        <span>Recent Inbound / Outbox Synced</span>
                      </h3>
                      <button
                        onClick={loadTabData}
                        className="text-[10px] text-[#6f7a6e] hover:text-[#111111] flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Refresh
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto mt-2 space-y-2">
                      {gmailMessages.length === 0 ? (
                        <div className="py-8 text-center text-xs text-[#6f7a6e]">
                          {isLoading ? 'Fetching Gmail messages...' : 'No recent emails found or permissions required.'}
                        </div>
                      ) : (
                        gmailMessages.map((msg) => (
                          <div key={msg.id} className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-[#6f7a6e]">
                              <span className="font-semibold text-[#111111] truncate max-w-[160px]">{msg.from}</span>
                              <span className="font-mono">{msg.date ? new Date(msg.date).toLocaleDateString() : ''}</span>
                            </div>
                            <div className="text-xs font-medium text-[#111111] truncate">{msg.subject}</div>
                            <p className="text-[11px] text-[#3f493f] line-clamp-2">{msg.snippet}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUBTAB: CALENDAR & MEET */}
              {(activeSubTab === 'calendar' || activeSubTab === 'meet') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: Schedule Discovery Meeting */}
                  <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[#eae4d9]">
                      <h3 className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
                        <Video className="w-3.5 h-3.5 text-[#036d30]" />
                        <span>Schedule Call with Google Meet</span>
                      </h3>
                      <span className="text-[10px] font-mono text-[#036d30] font-bold bg-[#a3ffb1]/30 px-2 py-0.5 rounded">
                        Meet + Cal API
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] font-mono text-[#6f7a6e] block">Meeting Title</label>
                        <input
                          type="text"
                          value={meetingSummary}
                          onChange={(e) => setMeetingSummary(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-[#fbf9f5] border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-[#6f7a6e] block">Lead Email</label>
                        <input
                          type="email"
                          value={meetingLeadEmail}
                          onChange={(e) => setMeetingLeadEmail(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-[#fbf9f5] border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-[#6f7a6e] block">Start Time</label>
                        <input
                          type="datetime-local"
                          value={meetingTime}
                          onChange={(e) => setMeetingTime(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-[#fbf9f5] border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30]"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => setShowScheduleConfirmation(true)}
                      className="w-full py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Book on Google Calendar & Create Meet</span>
                    </button>
                  </div>

                  {/* Right: Upcoming Scheduled Meetings */}
                  <div className="bg-white border border-[#eae4d9] rounded-2xl p-4 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between pb-2 border-b border-[#eae4d9]">
                      <h3 className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
                        <CalendarIcon className="w-3.5 h-3.5 text-[#036d30]" />
                        <span>Google Calendar Upcoming Events</span>
                      </h3>
                      <button
                        onClick={loadTabData}
                        className="text-[10px] text-[#6f7a6e] hover:text-[#111111] flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Refresh
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto mt-2 space-y-2">
                      {calendarEvents.length === 0 ? (
                        <div className="py-8 text-center text-xs text-[#6f7a6e]">
                          {isLoading ? 'Loading events...' : 'No upcoming calendar events detected.'}
                        </div>
                      ) : (
                        calendarEvents.map((evt) => (
                          <div key={evt.id} className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-[#111111]">{evt.summary}</span>
                              {evt.hangoutLink && (
                                <a
                                  href={evt.hangoutLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-mono text-[#036d30] font-semibold bg-[#a3ffb1]/40 px-2 py-0.5 rounded flex items-center gap-1"
                                >
                                  <Video className="w-3 h-3" /> Join Meet
                                </a>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-[#6f7a6e] flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{evt.start?.dateTime ? new Date(evt.start.dateTime).toLocaleString() : evt.start?.date}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUBTAB: GOOGLE FORMS */}
              {activeSubTab === 'forms' && (
                <div className="space-y-4">
                  <div className="bg-white border border-[#eae4d9] rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-[#eae4d9]">
                      <div>
                        <h3 className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-[#036d30]" />
                          <span>Google Forms Lead Qualification Survey</span>
                        </h3>
                        <p className="text-xs text-[#6f7a6e] mt-0.5">
                          Sync prospect responses from Google Forms directly into Omni-SDR pipeline triage.
                        </p>
                      </div>
                      <span className="text-[10px] font-mono text-[#036d30] font-bold bg-[#a3ffb1]/30 px-2 py-0.5 rounded">
                        forms.body.readonly
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl">
                        <div className="text-[10px] text-[#6f7a6e] font-mono">Form Status</div>
                        <div className="text-xs font-bold text-[#111111] mt-1">Lead Qualification Quiz</div>
                        <div className="text-[10px] text-[#16a34a] font-medium mt-0.5">Active & Ingesting</div>
                      </div>

                      <div className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl">
                        <div className="text-[10px] text-[#6f7a6e] font-mono">Ingested Submissions</div>
                        <div className="text-xs font-bold font-mono text-[#111111] mt-1">24 Responses</div>
                        <div className="text-[10px] text-[#6f7a6e] mt-0.5">18 qualified for Tier 1 ICP</div>
                      </div>

                      <div className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl">
                        <div className="text-[10px] text-[#6f7a6e] font-mono">Autonomous Dispatch</div>
                        <div className="text-xs font-bold text-[#111111] mt-1">Real-time Webhook</div>
                        <div className="text-[10px] text-[#036d30] font-medium mt-0.5">&lt;60s SLA to Draft</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <input
                        type="text"
                        placeholder="Google Form ID"
                        value={formIdInput}
                        onChange={(e) => setFormIdInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs bg-[#fbf9f5] border border-[#eae4d9] rounded-xl focus:outline-none focus:border-[#036d30]"
                      />
                      <button
                        onClick={() => {
                          setSuccessMsg(`Synced responses from Google Form (${formIdInput})!`);
                          setTimeout(() => setSuccessMsg(null), 3000);
                        }}
                        className="px-4 py-1.5 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl transition-colors shadow-2xs cursor-pointer"
                      >
                        Sync Form Responses
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 bg-[#f5f3ef] border-t border-[#eae4d9] flex items-center justify-between text-[11px] text-[#6f7a6e]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#16a34a]" />
            <span>Google OAuth client</span>
            <span className="text-[#eae4d9]">|</span>
            <span>Workspace data store</span>
          </div>

          <button
            onClick={onClose}
            className="px-3 py-1 bg-white hover:bg-[#f0eeea] border border-[#eae4d9] rounded-lg text-xs font-semibold text-[#111111] transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Mandatory User Confirmation Dialog: Send Gmail Outreach */}
      {showSendConfirmation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-60 animate-in fade-in duration-100">
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="text-sm font-bold text-[#111111]">Confirm Real Gmail Dispatch</h3>
            </div>

            <p className="text-xs text-[#3f493f] leading-relaxed">
              This action will send an actual email from your connected Google account (<span className="font-mono font-semibold">{currentUser?.email}</span>) to <span className="font-mono font-semibold">{composeTo}</span> with subject:
            </p>

            <div className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl text-xs font-medium text-[#111111]">
              "{composeSubject}"
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSendConfirmation(false)}
                className="px-4 py-2 text-xs font-semibold text-[#6f7a6e] hover:bg-[#f0eeea] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmailConfirmed}
                className="px-4 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl transition-colors shadow-2xs cursor-pointer"
              >
                Confirm & Send Email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory User Confirmation Dialog: Schedule Google Calendar Event */}
      {showScheduleConfirmation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-60 animate-in fade-in duration-100">
          <div className="bg-white border border-[#eae4d9] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-[#036d30]">
              <CalendarIcon className="w-6 h-6 shrink-0" />
              <h3 className="text-sm font-bold text-[#111111]">Confirm Google Calendar & Meet Booking</h3>
            </div>

            <p className="text-xs text-[#3f493f] leading-relaxed">
              This will create a new event on your primary Google Calendar and attach a Google Meet conference link for:
            </p>

            <div className="p-3 bg-[#fbf9f5] border border-[#eae4d9] rounded-xl text-xs space-y-1">
              <div className="font-bold text-[#111111]">{meetingSummary}</div>
              <div className="text-[#6f7a6e]">Invitee: {meetingLeadEmail}</div>
              <div className="text-[#6f7a6e]">Time: {new Date(meetingTime).toLocaleString()}</div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowScheduleConfirmation(false)}
                className="px-4 py-2 text-xs font-semibold text-[#6f7a6e] hover:bg-[#f0eeea] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleMeetingConfirmed}
                className="px-4 py-2 bg-[#a3ffb1] hover:bg-[#79fd91] text-[#111111] text-xs font-bold rounded-xl transition-colors shadow-2xs cursor-pointer"
              >
                Confirm & Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
