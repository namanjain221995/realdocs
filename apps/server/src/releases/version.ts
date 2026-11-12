/** Semantic-version precedence for release versions (shared with the desktop app via the contracts). */
export {
  compareReleaseVersions as compareVersions,
  parseReleaseVersion as parseVersion,
  type ParsedVersion,
} from '@realtimedocs/contracts';
