/**
 * DOM-free entry point: `@realtimedocs/editor/schema`.
 * Safe to import from Node.js (server, tests) and from the Electron main process.
 */
export {
  EMPTY_DOCUMENT,
  FONT_SIZES,
  HEADING_LEVELS,
  TEXT_ALIGNMENTS,
  createSchemaExtensions,
  getDocumentSchema,
} from './extensions';
export type { DocJSON, SchemaExtensionOptions } from './extensions';
export {
  ALLOWED_LINK_PROTOCOLS,
  isSafeExternalUrl,
  isSafeLinkHref,
  sanitizeLinkHref,
} from './links';
export {
  AttachmentNode,
  BlockFormat,
  CALLOUT_VARIANTS,
  CalloutNode,
  DIAGRAM_LANGUAGES,
  DiagramNode,
  IMAGE_ALIGNMENTS,
  ImageNode,
  LINE_HEIGHTS,
  MAX_INDENT,
  NODE_ATTACHMENT,
  NODE_CALLOUT,
  NODE_DIAGRAM,
  NODE_IMAGE,
} from './nodes';
export type {
  AttachmentAttrs,
  CalloutVariant,
  DiagramLanguage,
  ImageAlignment,
  ImageAttrs,
  LineHeight,
} from './nodes';
export {
  SAMPLE_CODE,
  SAMPLE_DOCUMENT_TITLE,
  SAMPLE_MERMAID_SOURCE,
  buildSampleDocument,
} from './sample';
