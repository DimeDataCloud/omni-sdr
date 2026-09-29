"use client";
import React, { useState, useEffect } from 'react';
import { User } from './lib/firebase';
import { 
  Agent, 
  ChatMessage, 
  ApprovalItem, 
  RoutineItem, 
  Workspace, 
  UserRole, 
  InboundReply, 
  Meeting 
} from './ui-types';
import { 
  INITIAL_AGENTS, 
  INITIAL_CONVERSATION_MESSAGES, 
  INITIAL_APPROVALS, 
  INITIAL_ROUTINES, 
  WORKSPACES, 
  INITIAL_INBOUND_REPLIES, 
  INITIAL_MEETINGS, 
  CURRENT_ORG 
} from './data/mockData';
import { TopNavigation } from './components/TopNavigation';
import { AgentSidebar } from './components/AgentSidebar';
import { ChatWorkspace } from './components/ChatWorkspace';
import { CapacityDispatchPanel } from './components/CapacityDispatchPanel';
import { InspectStateDrawer } from './components/InspectStateDrawer';
import { ReviewApprovalModal } from './components/ReviewApprovalModal';
import { DocumentViewerModal } from './components/DocumentViewerModal';
import { DeployAgentModal } from './components/DeployAgentModal';
import { SearchPaletteModal } from './components/SearchPaletteModal';
import { GoogleWorkspaceModal } from './components/GoogleWorkspaceModal';
import { ApprovalsView } from './views/ApprovalsView';
import { AnalyticsView } from './views/AnalyticsView';
import { StudioView } from './views/StudioView';
import { SkillsConnectionsView } from './views/SkillsConnectionsView';
import { SettingsView } from './views/SettingsView';
import { initAuth, setAccessToken, db, getAccessToken, doc, setDoc } from './lib/firebase';
import { sendGmailOutreach } from './lib/googleWorkspace';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('chat');
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('chief-of-staff');
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>(INITIAL_CONVERSATION_MESSAGES);
  const [approvals, setApprovals] = useState<ApprovalItem[]>(INITIAL_APPROVALS);
  const [routines, setRoutines] = useState<RoutineItem[]>(INITIAL_ROUTINES);
  const [inboundReplies, setInboundReplies] = useState<InboundReply[]>(INITIAL_INBOUND_REPLIES);
  const [meetings, setMeetings] = useState<Meeting[]>(INITIAL_MEETINGS);
  const [credits, setCredits] = useState<number>(4850);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Station 01 & Architecture State
  const [workspaces, setWorkspaces] = useState<Workspace[]>(WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('ws-retool');
  const [currentRole, setCurrentRole] = useState<UserRole>('operator');
  const [trustDialLevel, setTrustDialLevel] = useState<1 | 2>(1);

  // Authentication & Google Workspace Integration
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState<boolean>(false);

  // Modals state
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [isDocViewerOpen, setIsDocViewerOpen] = useState(false);
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [reviewItem, setReviewItem] = useState<ApprovalItem | null>(null);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user: any, token: any) => {
        setCurrentUser(user);
        if (token) setAccessToken(token);
        // Persist/Update user profile in Firestore
        if (user.uid) {
          setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Operator',
            photoURL: user.photoURL || '',
            role: 'operator',
            createdAt: new Date().toISOString()
          }, { merge: true }).catch((err) => console.warn('Firestore user profile sync:', err));
        }
      },
      () => {
        setCurrentUser(null);
        setAccessToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  const activeAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  const activeMessages = messagesMap[selectedAgentId] || [];

  // Filter pending approvals for the right-hand panel & badges
  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const currentPendingApproval = pendingApprovals.length > 0 ? pendingApprovals[0] : null;
  const urgentInboundCount = inboundReplies.filter(r => !r.handled && (r.slaMinutesRemaining || 999) < 60).length;

  // Global Keyboard Shortcuts (⌘S for Search, ⌘N for Deploy)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // ⌘S or Ctrl+S: Search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      // ⌘N or Ctrl+N: Deploy Agent
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setIsDeployOpen(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleSendMessage = (text: string) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const newUserMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      author: currentUser?.displayName || 'alexchen.auth',
      time: timeStr,
      content: text
    };

    const updated = [...activeMessages, newUserMsg];
    setMessagesMap(prev => ({
      ...prev,
      [selectedAgentId]: updated
    }));

    // Synthesize autonomous agent response based on context & Claims-Gate verification
    setTimeout(() => {
      let replyContent = '';
      let channelTag: string | undefined = undefined;
      let claimsGateStatus: 'passed' | 'warning' | 'blocked' = 'passed';
      let evidenceAnchorSnippet = '';
      let creditCost = 2;
      let executionTime = '34ms';

      const lower = text.toLowerCase();
      if (lower.includes('/hunt-contacts') || lower.includes('hunt') || lower.includes('prospects')) {
        replyContent = `Targeting 12 qualified VP Sales and Head of RevOps leads across Tier-1 accounts. Apollo enrichment complete; 4 draft cadences passed Claims Gate and are queued in Approvals.`;
        evidenceAnchorSnippet = `Verified active hiring signals: Retool & Supabase expansion pods verified against Google Places & LinkedIn.`;
        creditCost = 3;
        executionTime = '48ms';
      } else if (lower.includes('/schedule-sync') || lower.includes('calendar') || lower.includes('meeting') || lower.includes('slot')) {
        replyContent = `Scanned Google Calendar via native free/busy picker. Injected 3 open slots: Thursday 2:00 PM, 3:30 PM, and 4:30 PM EDT with Google Meet video room hold.`;
        evidenceAnchorSnippet = `Native Google Calendar (3-slot free/busy hold) confirmed with zero conflict.`;
        creditCost = 1;
        executionTime = '16ms';
      } else if (lower.includes('/audit-pipeline') || lower.includes('pipeline') || lower.includes('audit')) {
        replyContent = `CRM audit complete: 18 opportunities analyzed across ${workspaces.find(w => w.id === activeWorkspaceId)?.name}. 3 accounts require follow-up before end-of-week. Dispatched summary alert.`;
        evidenceAnchorSnippet = `Salesforce + Cloudflare Email Routing records matched; 0 invalid emails detected.`;
        creditCost = 2;
        executionTime = '28ms';
      } else if (lower.includes('/slack-blast') || lower.includes('slack') || lower.includes('post')) {
        replyContent = `Dispatched announcement to #brightside-shared and #sales-outbound Slack channels. All links verified with Claims Gate.`;
        channelTag = '#brightside-shared';
        evidenceAnchorSnippet = `Shipment verified: Okta SAML SSO & Slack Connect webhooks confirmed live.`;
        creditCost = 2;
        executionTime = '32ms';
      } else if (lower.includes('drive') || lower.includes('picker') || lower.includes('deck')) {
        replyContent = `Connected to Google Drive API. Synchronized collateral folder 'Tier 1 Enterprise Pitch Decks'. Ready to attach directly into SDR sequences.`;
        evidenceAnchorSnippet = `Google Drive v3 verified: read access to customer briefs enabled.`;
        creditCost = 1;
        executionTime = '20ms';
      } else if (lower.includes('brightside')) {
        replyContent = `Brightside Health pilot tracker updated. Okta SSO verification logs and Slack Connect webhooks are green. Kickoff agenda confirmed for Thursday.`;
        evidenceAnchorSnippet = `Brightside Kickoff Agenda v2.1 validated against SOC2 compliance checklist.`;
        creditCost = 1;
        executionTime = '22ms';
      } else {
        replyContent = `Understood. Analyzing context across CRM, Slack, and Google Workspace (Drive, Gmail, Calendar). Dispatched instructions and recorded in audit log.`;
        evidenceAnchorSnippet = `Claims-Gate pre-send validator verified: 100% operational anchor citations required.`;
        creditCost = 2;
        executionTime = '35ms';
      }

      const agentReply: ChatMessage = {
        id: `agent-reply-${Date.now()}`,
        sender: 'agent',
        author: activeAgent.name,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        content: replyContent,
        channelTag: channelTag,
        claimsGateStatus: claimsGateStatus,
        evidenceAnchorSnippet: evidenceAnchorSnippet,
        creditCost: creditCost,
        executionTime: executionTime
      };

      setMessagesMap(prev => ({
        ...prev,
        [selectedAgentId]: [...(prev[selectedAgentId] || []), agentReply]
      }));

      // Deduct small credit burn
      setCredits(c => Math.max(0, c - creditCost));
    }, 1100);
  };

  const handleApprove = (id: string) => {
    setApprovals(prev => prev.map(item => item.id === id ? { ...item, status: 'approved' } : item));
    setCredits(c => Math.max(0, c - 2));

    // Sync to Firestore if authenticated
    if (currentUser?.uid) {
      setDoc(doc(db, 'workspaces', activeWorkspaceId, 'approvals', id), {
        status: 'approved',
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(() => {});
    }
  };

  const handleReject = (id: string) => {
    setApprovals(prev => prev.map(item => item.id === id ? { ...item, status: 'rejected' } : item));
    if (currentUser?.uid) {
      setDoc(doc(db, 'workspaces', activeWorkspaceId, 'approvals', id), {
        status: 'rejected',
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(() => {});
    }
  };

  const handleApproveAll = () => {
    setApprovals(prev => prev.map(item => item.icpFit >= 90 ? { ...item, status: 'approved' } : item));
  };

  const handleToggleRoutine = (id: string) => {
    setRoutines(prev => prev.map(r => {
      if (r.id === id) {
        const nextActive = r.pausedByAdmin ? true : !r.active;
        if (currentUser?.uid) {
          setDoc(doc(db, 'workspaces', activeWorkspaceId, 'routines', id), {
            active: nextActive,
            pausedByAdmin: false
          }, { merge: true }).catch(() => {});
        }
        return { ...r, pausedByAdmin: false, active: nextActive };
      }
      return r;
    }));
  };

  const handleHandleInboundReply = (replyId: string) => {
    setInboundReplies(prev => prev.map(r => r.id === replyId ? { ...r, handled: true } : r));
    const matchedReply = inboundReplies.find(r => r.id === replyId);
    if (matchedReply) {
      const newMeeting: Meeting = {
        id: `meet-${Date.now()}`,
        workspaceId: activeWorkspaceId,
        leadId: matchedReply.leadId,
        leadName: matchedReply.leadName,
        leadCompany: matchedReply.leadCompany,
        provider: 'native_google_cal',
        scheduledTime: 'Thursday @ 2:00 PM EDT (Provisional Google Meet Hold)',
        status: 'booked',
        createdAt: new Date().toISOString()
      };
      setMeetings(prev => [newMeeting, ...prev]);

      if (currentUser?.uid) {
        setDoc(doc(db, 'workspaces', activeWorkspaceId, 'meetings', newMeeting.id), {
          ...newMeeting,
          ownerId: currentUser.uid
        }).catch(() => {});
      }
    }
  };

  // Direct Gmail dispatch from Approvals modal
  const handleSendViaGmail = async (item: ApprovalItem) => {
    const token = await getAccessToken();
    if (!token) {
      setIsWorkspaceModalOpen(true);
      return;
    }

    try {
      const recipientEmail = `${item.recipientName.toLowerCase().replace(/\s+/g, '.')}@${item.recipientCompany.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
      await sendGmailOutreach(token, {
        to: recipientEmail,
        subject: item.subject,
        body: item.fullSequence[0]?.content || item.bodyPreview
      });
      handleApprove(item.id);
      alert(`Success! Email dispatched to ${recipientEmail} via your Gmail account.`);
    } catch (err: any) {
      console.error(err);
      alert(`Failed to send email: ${err.message || 'Please check Google Workspace permissions'}`);
    }
  };

  // Handle attaching Google Drive files into conversation
  const handleAttachDriveFile = (file: { name: string; url: string; mimeType: string }) => {
    const userMsg: ChatMessage = {
      id: `msg-attach-${Date.now()}`,
      sender: 'user',
      author: currentUser?.displayName || 'Operator',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: `Attached Google Drive document: [${file.name}](${file.url})`,
      attachment: {
        type: file.mimeType.includes('sheet') ? 'sheet' : 'doc',
        title: file.name,
        details: 'Google Drive 1P Asset · Synchronized with Agent Context',
        version: 'v1.0'
      }
    };

    setMessagesMap(prev => ({
      ...prev,
      [selectedAgentId]: [...(prev[selectedAgentId] || []), userMsg]
    }));
  };

  const handleDeployAgent = (newAgent: Agent) => {
    setAgents(prev => [newAgent, ...prev]);
    setSelectedAgentId(newAgent.id);
    setMessagesMap(prev => ({
      ...prev,
      [newAgent.id]: [
        {
          id: `init-${Date.now()}`,
          sender: 'agent',
          author: newAgent.name,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          content: `Station ${newAgent.stationName} online. Connected to ${newAgent.contextSources.join(', ')}. Claims-Gate validator active.`
        }
      ]
    }));
  };

  return (
    <div className="min-h-screen bg-[#fbf9f5] flex flex-col font-sans text-[#111111]">
      {/* Top Bar Contract (1 Row, 3 Zones) */}
      <TopNavigation
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
        approvalsCount={pendingApprovals.length}
        inboundSlaCount={urgentInboundCount}
        credits={credits}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={setActiveWorkspaceId}
        currentRole={currentRole}
        onChangeRole={setCurrentRole}
        trustDialLevel={trustDialLevel}
        onToggleTrustDial={() => setTrustDialLevel(l => l === 1 ? 2 : 1)}
        currentUser={currentUser}
        onOpenWorkspaceModal={() => setIsWorkspaceModalOpen(true)}
      />

      {/* Main Workspace Frame */}
      {currentTab === 'chat' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Fleet Agents Sidebar */}
          <AgentSidebar
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(id) => setSelectedAgentId(id)}
            onOpenDeployModal={() => setIsDeployOpen(true)}
            onOpenSearchPalette={() => setIsSearchOpen(true)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

          {/* Center Column: Station Command & Conversation Workspace */}
          <ChatWorkspace
            agent={activeAgent}
            messages={activeMessages}
            onSendMessage={handleSendMessage}
            onOpenInspectState={() => setIsInspectOpen(true)}
            onOpenDocViewer={() => setIsDocViewerOpen(true)}
            isRightPanelOpen={isRightPanelOpen}
            onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
            onTriggerQuickPrompt={(prompt) => handleSendMessage(prompt)}
            onNavigateToApprovals={() => setCurrentTab('approvals')}
            onOpenWorkspaceModal={() => setIsWorkspaceModalOpen(true)}
          />

          {/* Right Column: Capacity & Dispatch Panel */}
          {isRightPanelOpen && (
            <CapacityDispatchPanel
              currentApproval={currentPendingApproval}
              onApprove={handleApprove}
              onOpenReviewModal={(item) => setReviewItem(item)}
              routines={routines}
              onToggleRoutine={handleToggleRoutine}
              onAddNewRoutine={() => alert("Creating new autonomous routine schedule...")}
              onViewAllApprovals={() => setCurrentTab('approvals')}
              inboundReplies={inboundReplies}
              meetings={meetings}
              onHandleInboundReply={handleHandleInboundReply}
            />
          )}
        </div>
      )}

      {currentTab === 'approvals' && (
        <ApprovalsView
          approvals={pendingApprovals}
          onApprove={handleApprove}
          onReject={handleReject}
          onOpenReview={(item) => setReviewItem(item)}
          onApproveAll={handleApproveAll}
          inboundReplies={inboundReplies}
          onHandleInboundReply={handleHandleInboundReply}
        />
      )}

      {currentTab === 'analytics' && <AnalyticsView />}

      {currentTab === 'studio' && (
        <StudioView
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={(id) => setSelectedAgentId(id)}
        />
      )}

      {currentTab === 'skills' && (
        <SkillsConnectionsView
          onOpenWorkspaceModal={() => setIsWorkspaceModalOpen(true)}
        />
      )}

      {currentTab === 'settings' && (
        <SettingsView
          org={CURRENT_ORG}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
        />
      )}

      {/* Interactive Modals & Drawers */}
      <InspectStateDrawer
        agent={activeAgent}
        isOpen={isInspectOpen}
        onClose={() => setIsInspectOpen(false)}
      />

      <ReviewApprovalModal
        item={reviewItem}
        isOpen={Boolean(reviewItem)}
        onClose={() => setReviewItem(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        onSendViaGmail={handleSendViaGmail}
      />

      <DocumentViewerModal
        isOpen={isDocViewerOpen}
        onClose={() => setIsDocViewerOpen(false)}
      />

      <DeployAgentModal
        isOpen={isDeployOpen}
        onClose={() => setIsDeployOpen(false)}
        onDeploy={handleDeployAgent}
      />

      <SearchPaletteModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        agents={agents}
        onSelectAgent={(id) => {
          setSelectedAgentId(id);
          setCurrentTab('chat');
        }}
        approvals={pendingApprovals}
        onSelectApproval={(item) => setReviewItem(item)}
      />

      {/* Google Workspace Hub Modal */}
      <GoogleWorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
        currentUser={currentUser}
        onAuthSuccess={(user, token) => {
          setCurrentUser(user);
          setAccessToken(token);
        }}
        onAuthLogout={() => {
          setCurrentUser(null);
          setAccessToken(null);
        }}
        onAttachFileToChat={handleAttachDriveFile}
      />
    </div>
  );
}

