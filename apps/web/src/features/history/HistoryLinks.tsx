/**
 * Entry points to the version history, used by the document header. Kept here
 * so the header needs one import and no routing knowledge.
 */
import { MenuItem } from '@realtimedocs/ui';
import { ScrollText } from 'lucide-react';
import { RouterLinkButton, useRouterLink } from '../../components/links';

export function documentHistoryPath(documentId: string): string {
  return `/d/${documentId}/history`;
}

/** An entry of the "More actions" menu. */
export function HistoryMenuItem({ documentId }: { documentId: string }) {
  const link = useRouterLink(documentHistoryPath(documentId));
  return (
    <MenuItem
      icon={<ScrollText />}
      href={link.href}
      onClick={link.onClick}
      data-testid="open-history"
    >
      Version history
    </MenuItem>
  );
}

/** The header button; icon only when the header is crowded. */
export function HistoryHeaderLink({
  documentId,
  iconsOnly,
}: {
  documentId: string;
  iconsOnly: boolean;
}) {
  const to = documentHistoryPath(documentId);
  return iconsOnly ? (
    <RouterLinkButton
      to={to}
      aria-label="Version history"
      title="Version history"
      iconLeft={<ScrollText />}
      data-testid="open-history"
    />
  ) : (
    <RouterLinkButton to={to} iconLeft={<ScrollText />} data-testid="open-history">
      Version history
    </RouterLinkButton>
  );
}
