export interface DisplayPicture {
  png: Buffer;
  width: number;
  height: number;
  /** Rows of RGB bytes, top to bottom. */
  rgb: Buffer;
  /** Share of colour channels that are not (nearly) black. */
  litRatio: number;
}

export function decodeXwd(xwd: Buffer): { width: number; height: number; rgb: Buffer };
export function xwdToPng(xwd: Buffer): DisplayPicture;
export function readDisplay(directory: string | null | undefined): DisplayPicture | null;
export function displayDifference(
  before: Pick<DisplayPicture, 'width' | 'height' | 'rgb'>,
  after: Pick<DisplayPicture, 'width' | 'height' | 'rgb'>,
): { changed: number; box: { x: number; y: number; width: number; height: number } | null };
