-- Desktop release distribution: anonymous download counters.
-- One row per day and artifact kind. No IP address, no user agent, no identifier of any person is
-- stored. Releases themselves live on disk (DOWNLOAD_DIR), not in the database. Additive only.
CREATE TABLE release_download_counts (
  day      date    NOT NULL,
  channel  text    NOT NULL CHECK (channel IN ('stable', 'beta')),
  version  text    NOT NULL CHECK (char_length(version) <= 64),
  platform text    NOT NULL CHECK (platform IN ('windows', 'macos', 'linux')),
  arch     text    NOT NULL CHECK (arch IN ('x64', 'arm64', 'universal')),
  format   text    NOT NULL CHECK (format IN ('zip', 'exe', 'dmg', 'appimage', 'tar.gz')),
  count    bigint  NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, channel, version, platform, arch, format)
);
CREATE INDEX release_download_counts_version_idx ON release_download_counts (channel, version);
