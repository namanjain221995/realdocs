import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  StatusDot,
  Switch,
  TextField,
  type Tone,
} from '@realtimedocs/ui';
import { Link2, Server } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ServerStatus } from '../../shared/state';
import { attempt, desktop } from '../shared/desktop';
import { formatDateTime } from '../shared/labels';
import type { TabProps } from './SettingsApp';

const SERVER_STATUS: Record<ServerStatus, { label: string; tone: Tone; pulse: boolean }> = {
  unset: { label: 'No server set', tone: 'neutral', pulse: false },
  unchecked: { label: 'Not checked yet', tone: 'neutral', pulse: false },
  checking: { label: 'Checking…', tone: 'warning', pulse: true },
  ok: { label: 'Connected to a RealtimeDocs server', tone: 'success', pulse: false },
  unreachable: { label: 'Server could not be reached', tone: 'danger', pulse: false },
  not_realtimedocs: { label: 'Not a RealtimeDocs server', tone: 'danger', pulse: false },
  update_required: { label: 'Versions do not match', tone: 'danger', pulse: false },
};

const TRANSPORT_LABELS = {
  https: 'HTTPS',
  loopback_http: 'This computer (localhost)',
  insecure_lan_http: 'Plain HTTP — development override',
} as const;

function ServerSection({ state, run }: TabProps) {
  const { server } = state.connection;
  const [address, setAddress] = useState(server.origin ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Follow changes made elsewhere (for example confirming a link for another server).
  useEffect(() => {
    setAddress(server.origin ?? '');
  }, [server.origin]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const message = await attempt(desktop?.connection.setServer(address));
    setBusy(false);
    setError(message);
  };

  const status = SERVER_STATUS[server.status];
  return (
    <Card padding="lg" className="rds-card">
      <h2 className="rds-h2">Server</h2>
      <p className="rds-lead">
        RealtimeDocs Desktop talks to one server, the one you enter here. Links never change it
        without asking you first.
      </p>
      <form className="rds-inline-form" onSubmit={(event) => void save(event)}>
        <TextField
          label="Server address"
          placeholder="https://docs.example.com"
          hint="HTTPS address of your RealtimeDocs server, or http://localhost:<port> for a tunnel."
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setError(null);
          }}
          error={error ?? undefined}
          prefix={<Server />}
          autoComplete="off"
          spellCheck={false}
          data-testid="rd-server-input"
        />
        <Button type="submit" variant="primary" loading={busy} data-testid="rd-server-save">
          Save and check
        </Button>
      </form>

      <div className="rds-status-row" data-testid="rd-server-status" data-status={server.status}>
        <StatusDot tone={status.tone} pulse={status.pulse} />
        <span className="rds-status-label">{status.label}</span>
        {server.transport && (
          <Badge tone={server.transport === 'insecure_lan_http' ? 'warning' : 'neutral'}>
            {TRANSPORT_LABELS[server.transport]}
          </Badge>
        )}
        {server.serverVersion && <span className="rds-muted">Server {server.serverVersion}</span>}
        {server.origin && (
          <Button size="sm" variant="ghost" onClick={() => void run(desktop?.connection.check())}>
            Check again
          </Button>
        )}
      </div>
      {server.message && (
        <p className="rds-status-message" data-testid="rd-server-message">
          {server.message}
        </p>
      )}
      {server.checkedAt && (
        <p className="rds-muted rds-small">Last checked {formatDateTime(server.checkedAt)}</p>
      )}
    </Card>
  );
}

function WhereIsTheServer() {
  return (
    <Card padding="lg" className="rds-card">
      <h2 className="rds-h2">“localhost” means this computer</h2>
      <p>
        If RealtimeDocs runs on a server you reach over SSH, <code>localhost</code> in a terminal
        there is the <em>server</em>. Typed here, <code>localhost</code> is{' '}
        <em>this Windows or Mac computer</em>. They are different machines.
      </p>
      <ul className="rds-list">
        <li>
          <strong>Deployed server:</strong> enter its HTTPS address, for example{' '}
          <code>https://docs.example.com</code>. The live connection then uses WSS automatically.
        </li>
        <li>
          <strong>Development over SSH:</strong> open a tunnel from this computer, for example{' '}
          <code>ssh -L 4310:127.0.0.1:4310 you@server</code>, keep it running, and enter{' '}
          <code>http://localhost:4310</code>. Traffic is encrypted by SSH; nothing is exposed on the
          network.
        </li>
      </ul>
      <p className="rds-muted rds-small">
        RealtimeDocs Desktop never opens ports, starts tunnels or publishes a server by itself.
      </p>
    </Card>
  );
}

function LinkOptions({ state, run }: TabProps) {
  const { server, acceptedLinkOrigin, allowInsecureLan } = state.connection;
  const differs =
    server.origin !== null && server.publicOrigin !== null && server.publicOrigin !== server.origin;
  return (
    <Card padding="lg" className="rds-card">
      <h2 className="rds-h2">Links and transport</h2>
      {differs || acceptedLinkOrigin ? (
        <Checkbox
          checked={acceptedLinkOrigin !== null}
          onCheckedChange={(checked) =>
            void run(desktop?.connection.setOptions({ acceptPublicOrigin: checked }))
          }
          label={`Accept links for ${new URL(acceptedLinkOrigin ?? server.publicOrigin ?? '').host}`}
          hint={`The server at ${new URL(server.origin ?? '').host} says its public address is ${server.publicOrigin ?? acceptedLinkOrigin ?? ''}, which is what its share links and “Open in Desktop” links contain. With this on, such links are opened through the address you entered above. They are never sent anywhere else.`}
          data-testid="rd-accept-public-origin"
        />
      ) : (
        <p className="rds-muted">
          Share links and “Open in Desktop” links are accepted only when they belong to the server
          above. A link for another server is refused, or, for a pasted share link, opened only
          after you confirm switching servers.
        </p>
      )}

      <div className="rds-divider" />
      <Switch
        checked={allowInsecureLan}
        onCheckedChange={(checked) =>
          void run(desktop?.connection.setOptions({ allowInsecureLan: checked }))
        }
        label="Development: allow plain HTTP to private-network addresses"
        hint="Off by default. Lets you enter an address such as http://192.168.1.20:4310. Traffic, including the document and your session, is then unencrypted on that network. Never accepted for public addresses."
        data-testid="rd-allow-insecure-lan"
      />
      {allowInsecureLan && (
        <Banner tone="warning">
          Plain-HTTP override is on. Prefer HTTPS or an SSH tunnel to localhost; turn this off when
          you are done testing.
        </Banner>
      )}
    </Card>
  );
}

function DocumentSection({ state, run }: TabProps) {
  const { session, busy } = state.connection;
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!link.trim()) return;
    setOpening(true);
    const message = await attempt(desktop?.connection.openShareLink(link.trim()));
    setOpening(false);
    setError(message);
    if (!message) setLink('');
  };

  return (
    <Card padding="lg" className="rds-card">
      <h2 className="rds-h2">Document</h2>
      {session ? (
        <dl className="rds-facts" data-testid="rd-session-facts">
          <dt>Open document</dt>
          <dd>{session.title || 'Untitled document'}</dd>
          <dt>Access</dt>
          <dd>
            {session.role === 'viewer'
              ? 'View only'
              : session.role === 'admin'
                ? 'Admin'
                : 'Can edit'}
            {' · '}
            {session.via === 'handoff' ? 'opened from the browser' : 'opened from a share link'}
          </dd>
          <dt>Access ends</dt>
          <dd>{session.expiresAt ? formatDateTime(session.expiresAt) : 'No fixed end'}</dd>
        </dl>
      ) : (
        <p className="rds-muted">No document is open.</p>
      )}
      {session && (
        <Button
          variant="danger"
          loading={busy === 'disconnecting'}
          onClick={() =>
            void run(desktop?.connection.disconnect(), 'Document closed and session forgotten.')
          }
          data-testid="rd-disconnect"
        >
          Close document and forget session
        </Button>
      )}

      <div className="rds-divider" />
      <form className="rds-inline-form" onSubmit={(event) => void open(event)}>
        <TextField
          label="Paste share link"
          placeholder="https://…/s/…#…"
          hint="The part after # is the key to the document. It is sent only to the server, in the request body."
          value={link}
          onChange={(event) => {
            setLink(event.target.value);
            setError(null);
          }}
          error={error ?? undefined}
          prefix={<Link2 />}
          autoComplete="off"
          spellCheck={false}
          data-testid="rd-settings-paste-input"
        />
        <Button type="submit" loading={opening} data-testid="rd-settings-paste-submit">
          Open
        </Button>
      </form>
    </Card>
  );
}

function StorageSection({ state }: TabProps) {
  const { credentials } = state;
  const encrypted = credentials.mode === 'os_encrypted';
  return (
    <Card padding="lg" className="rds-card">
      <h2 className="rds-h2">Where the session is kept</h2>
      <div
        className="rds-status-row"
        data-testid="rd-credential-storage"
        data-mode={credentials.mode}
      >
        <Badge tone={encrypted ? 'success' : 'warning'}>
          {encrypted ? 'Encrypted by the operating system' : 'In memory only'}
        </Badge>
        {credentials.backend && <span className="rds-muted">Backend: {credentials.backend}</span>}
      </div>
      <p>{credentials.detail}</p>
      <p className="rds-muted rds-small">
        The session is scoped to one document and never leaves the app’s main process: the document
        view cannot read it, and it is not written to the preferences file.
      </p>
    </Card>
  );
}

export function ConnectionTab(props: TabProps) {
  return (
    <div className="rds-stack">
      <ServerSection {...props} />
      <DocumentSection {...props} />
      <WhereIsTheServer />
      <LinkOptions {...props} />
      <StorageSection {...props} />
    </div>
  );
}
