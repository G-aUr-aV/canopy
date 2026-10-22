import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowClockwise, Check, Copy, FileCode, Hash, MagnifyingGlass, ShieldCheck, TextAlignLeft } from '@phosphor-icons/react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { gotoLine, openSearchPanel } from '@codemirror/search';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { bytes } from './api';
import type { FileData } from './types';

export function CodeReader({ file, onBack, onRefresh }: { file: FileData; onBack: () => void; onRefresh: () => void }) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const wrapping = useRef(new Compartment());
  const [wrap, setWrap] = useState(false);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const description = LanguageDescription.matchFilename(languages, file.name);
  const markdown = /\.(md|mdx|markdown)$/i.test(file.name);
  useEffect(() => { setPreview(false); setCopied(false); setCopyError(''); }, [file.root, file.path]);
  useEffect(() => {
    if (!parent.current || preview) return;
    const language = new Compartment();
    const editor = new EditorView({ parent: parent.current, doc: file.content, extensions: [
      basicSetup, EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorView.contentAttributes.of({ 'aria-label': `${file.name}, read-only code`, tabindex: '0' }),
      wrapping.current.of(wrap ? EditorView.lineWrapping : []), language.of([]),
      EditorView.theme({
        '&': { fontSize: '14px', backgroundColor: '#f9faf8', color: '#1d3739', height: '100%' },
        '.cm-scroller': { fontFamily: '"JetBrains Mono Variable", monospace', lineHeight: '1.85', overflow: 'auto' },
        '.cm-content': { padding: '20px 0', minWidth: '100%' },
        '.cm-line': { padding: '0 20px 0 12px' },
        '.cm-gutters': { background: '#f4f6f3', color: '#63716f', borderRight: '1px solid #e1e7e1', paddingLeft: '8px' },
        '.cm-activeLineGutter, .cm-activeLine': { background: 'transparent' },
        '.cm-panels': { background: '#fff', color: '#173f34' },
        '.cm-searchMatch': { background: '#ffe4a0' },
        '.cm-focused': { outline: 'none' },
        '.cm-selectionBackground': { background: '#c8e3d4 !important' },
      }),
    ] });
    view.current = editor;
    let canceled = false;
    description?.load().then(extension => { if (!canceled) editor.dispatch({ effects: language.reconfigure(extension) }); }).catch(() => { /* Keep the readable plain-text preview if a language module is unavailable. */ });
    return () => { canceled = true; editor.destroy(); view.current = null; };
  }, [file.content, file.path, preview]);
  useEffect(() => { view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  async function copy() {
    try { await navigator.clipboard.writeText(file.content); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setCopyError('Copy is unavailable here. Select text to copy it.'); }
  }
  return <section className="reader" aria-label="File reader">
    <div className="reader-mobile-top"><button className="text-button" onClick={onBack}><ArrowLeft size={22} />Files</button><div className="brand"><img src="/brand/canopy.png" alt="" />Canopy</div><span className="read-label"><ShieldCheck size={18} />Read only</span></div>
    <div className="reader-heading"><button className="icon-button desktop-back" aria-label="Back to folder" onClick={onBack}><ArrowLeft size={21} /></button><FileCode size={32} className="file-heading-icon" /><div className="file-heading-text"><h1>{file.name}</h1><p className="file-path" title={file.path}>{file.path.split('/').join(' / ')}</p></div><button className="icon-button" aria-label="Refresh file" title="Refresh file" onClick={onRefresh}><ArrowClockwise size={20} /></button></div>
    <p className="file-meta">{description?.name || 'Plain text'}<span>·</span>{file.encoding}<span>·</span>{bytes(file.size)}<span className="desktop-meta">· {file.permissions}</span></p>
    <div className="reader-toolbar"><div className="toolbar-group"><button onClick={() => { if (preview) setPreview(false); else if (view.current) openSearchPanel(view.current); }} disabled={preview}><MagnifyingGlass size={19} />Find</button><button aria-pressed={wrap} onClick={() => setWrap(!wrap)} disabled={preview}><TextAlignLeft size={19} /><span>Wrap text</span></button><button onClick={copy}>{copied ? <Check size={19} /> : <Copy size={19} />}<span>{copied ? 'Copied' : 'Copy'}</span></button></div>{markdown && <div className="range reader-modes"><button aria-pressed={!preview} onClick={() => setPreview(false)}>Source</button><button aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button></div>}</div>
    {file.truncated && <p className="notice">Showing the first {bytes(file.preview_bytes)} of {bytes(file.size)}. This preview is truncated.</p>}
    {copyError && <p className="notice" role="status">{copyError}</p>}
    {preview ? <article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span className="muted">[Image: {alt || 'embedded image'}]</span>, a: ({ href, children }) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>{file.content}</ReactMarkdown></article> : <div className="code-container" ref={parent} />}
    <div className="reader-status"><span>{file.content.split('\n').length.toLocaleString()} {file.truncated ? 'preview lines' : 'lines'} · Read only</span><span>{new Date(file.modified * 1000).toLocaleDateString()}</span></div>
    <div className="reader-bottom"><button onClick={onBack}><ArrowLeft size={21} />Back to folder</button><button onClick={() => { if (view.current) gotoLine(view.current); }} disabled={preview}><Hash size={21} />Go to line</button></div>
  </section>;
}
