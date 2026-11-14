-- Interviewers who have an account (docs/session-integration.md, "Interviewers with an account").
--
-- Additive only. When an interviewer named in an interview session has an active account with
-- the same e-mail address, the server adds them as a member of the session's document, so the
-- document appears in their own list. This column records that origin: a membership with a
-- participant here was created by the server for that participant and is removed with it; a
-- membership an administrator added by hand has NULL and is never removed automatically.
--
-- A nullable column without a default: a catalogue-only change, no table rewrite.
ALTER TABLE document_members
  ADD COLUMN interview_participant_id uuid REFERENCES interview_participants (id) ON DELETE SET NULL;

CREATE INDEX document_members_participant_idx ON document_members (interview_participant_id)
  WHERE interview_participant_id IS NOT NULL;

-- Was the account's e-mail address fixed by an administrator? The product sends no e-mail and
-- cannot verify an address. An address typed in at self sign-up, or chosen by the person who
-- accepted an invitation that named no address, is only a claim: such an account must never
-- receive documents because it says it is somebody's address. Only accounts with this flag are
-- linked to interview sessions. Constant default: a catalogue-only change.
ALTER TABLE users ADD COLUMN address_confirmed boolean NOT NULL DEFAULT true;

-- Existing accounts: members who did not accept an invitation issued for their address chose the
-- address themselves. Administrators see every document anyway and stay as they are.
UPDATE users u
   SET address_confirmed = false
 WHERE u.role = 'member'
   AND NOT EXISTS (
     SELECT 1 FROM invitations i WHERE i.accepted_by = u.id AND i.email IS NOT NULL
   );
