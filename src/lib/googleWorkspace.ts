// Config removed
export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  modifiedTime?: string;
  size?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  hangoutLink?: string;
  htmlLink?: string;
  attendees?: { email: string; responseStatus?: string }[];
}

export interface GmailMessageItem {
  id: string;
  threadId: string;
  snippet?: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
}

export interface GoogleFormItem {
  formId: string;
  title: string;
  description?: string;
  responderUri?: string;
  responsesCount?: number;
}

/**
 * Google Drive API Helpers
 */
export async function fetchDriveFiles(accessToken: string, queryParam = ''): Promise<GoogleDriveFile[]> {
  try {
    const q = queryParam ? `&q=${encodeURIComponent(queryParam)}` : '';
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?pageSize=15&fields=files(id,name,mimeType,webViewLink,iconLink,modifiedTime,size)${q}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      throw new Error(`Drive API error: ${res.statusText}`);
    }
    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error('Failed to fetch Drive files:', err);
    throw err;
  }
}

export async function uploadBriefToDrive(
  accessToken: string, 
  title: string, 
  content: string
): Promise<GoogleDriveFile> {
  const metadata = {
    name: title,
    mimeType: 'text/markdown',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', new Blob([content], { type: 'text/plain' }));

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to upload to Drive: ${res.statusText}`);
  }
  return await res.json();
}

/**
 * Google Picker API integration
 */
export async function openGoogleDrivePicker(
  accessToken: string,
  onFilePicked: (file: { id: string; name: string; url: string; mimeType: string }) => void
) {
  // If gapi is not loaded, dynamically load script
  if (!(window as any).gapi) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  const gapi = (window as any).gapi;
  await new Promise((resolve) => gapi.load('picker', resolve));

  const google = (window as any).google;
  if (!google || !google.picker) {
    throw new Error('Google Picker library could not be loaded');
  }

  const view = new google.picker.View(google.picker.ViewId.DOCS);
  view.setMimeTypes(
    'application/pdf,application/vnd.google-apps.document,application/vnd.google-apps.spreadsheet,application/vnd.google-apps.presentation,text/plain'
  );

  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey('dummy-api-key')
    .setAppId('dummy-app-id')
    .setCallback((data: any) => {
      if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
        const doc = data[google.picker.Response.DOCUMENTS][0];
        onFilePicked({
          id: doc.id,
          name: doc.name,
          url: doc.url || `https://drive.google.com/file/d/${doc.id}/view`,
          mimeType: doc.mimeType,
        });
      }
    })
    .build();

  picker.setVisible(true);
}

/**
 * Gmail API Helpers
 */
export async function fetchGmailMessages(accessToken: string): Promise<GmailMessageItem[]> {
  try {
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!listRes.ok) {
      throw new Error(`Gmail API error: ${listRes.statusText}`);
    }
    const listData = await listRes.json();
    const rawMessages = listData.messages || [];

    const detailed = await Promise.all(
      rawMessages.slice(0, 5).map(async (msg: { id: string }) => {
        try {
          const detailRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=To`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          if (!detailRes.ok) return { id: msg.id, threadId: '' };
          const data = await detailRes.json();
          const headers = data.payload?.headers || [];
          const getH = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value;

          return {
            id: msg.id,
            threadId: data.threadId,
            snippet: data.snippet,
            from: getH('From') || 'Unknown Sender',
            to: getH('To') || 'me',
            subject: getH('Subject') || '(No Subject)',
            date: getH('Date') || '',
          };
        } catch {
          return { id: msg.id, threadId: '' };
        }
      })
    );
    return detailed.filter((m) => m.id);
  } catch (err) {
    console.error('Failed to fetch Gmail messages:', err);
    throw err;
  }
}

export async function sendGmailOutreach(
  accessToken: string,
  params: { to: string; subject: string; body: string }
) {
  // Construct RFC 2822 email format
  const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`;
  const messageParts = [
    `To: ${params.to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    params.body,
  ];
  const message = messageParts.join('\r\n');
  const encodedMessage = btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    }
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(`Failed to send email: ${errorData.error?.message || res.statusText}`);
  }
  return await res.json();
}

export async function createGmailDraft(
  accessToken: string,
  params: { to: string; subject: string; body: string }
) {
  const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(params.subject)))}?=`;
  const messageParts = [
    `To: ${params.to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    params.body,
  ];
  const message = messageParts.join('\r\n');
  const encodedMessage = btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { raw: encodedMessage } }),
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to create Gmail draft: ${res.statusText}`);
  }
  return await res.json();
}

/**
 * Google Calendar & Google Meet API Helpers
 */
export async function fetchCalendarEvents(accessToken: string): Promise<GoogleCalendarEvent[]> {
  try {
    const timeMin = new Date().toISOString();
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
        timeMin
      )}&maxResults=10&singleEvents=true&orderBy=startTime`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      throw new Error(`Calendar API error: ${res.statusText}`);
    }
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error('Failed to fetch calendar events:', err);
    throw err;
  }
}

export async function createCalendarMeetingWithMeet(
  accessToken: string,
  params: {
    summary: string;
    description: string;
    startTime: string; // ISO string
    endTime: string;   // ISO string
    attendeeEmail?: string;
  }
): Promise<GoogleCalendarEvent> {
  const requestId = `meet-req-${Date.now()}`;
  const eventBody: any = {
    summary: params.summary,
    description: params.description,
    start: { dateTime: params.startTime },
    end: { dateTime: params.endTime },
    conferenceData: {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  if (params.attendeeEmail) {
    eventBody.attendees = [{ email: params.attendeeEmail }];
  }

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Calendar event creation failed: ${errData.error?.message || res.statusText}`);
  }
  return await res.json();
}

/**
 * Google Forms API Helpers
 */
export async function fetchFormDetails(accessToken: string, formId: string): Promise<GoogleFormItem> {
  try {
    const res = await fetch(`https://forms.googleapis.com/v1/forms/${formId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Forms API error: ${res.statusText}`);
    }
    const data = await res.json();
    return {
      formId: data.formId,
      title: data.info?.title || 'Lead Qualification Form',
      description: data.info?.description,
      responderUri: data.responderUri,
    };
  } catch (err) {
    console.error('Failed to fetch form:', err);
    throw err;
  }
}
