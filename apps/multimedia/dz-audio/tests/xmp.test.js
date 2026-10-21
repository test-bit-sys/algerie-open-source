import { describe, it, expect } from 'vitest';
import { buildXmp, parseXmp, wavXmpChunk } from '../src/audio/xmp.js';
import { id3v2Tag, parseId3v2, cleanMeta } from '../src/audio/meta.js';
import { runExport } from '../src/export/pipeline.js';
import { parseWav } from '../src/audio/wav.js';
import { META_TABS, metadataPanel } from '../src/panels/metadata.js';
import { AudioFile } from '../src/model/audio-file.js';
import { Channel } from '../src/audio/channel.js';
import { fakeApp } from './fx-helpers.js';

const META = { title: 'Field <Notes> & More', artist: 'Ana; Ben', description: 'Dawn chorus, take 2', copyright: '© 2026 Ana', keywords: 'birds, dawn, forest', publisher: 'Sound Club', language: 'en', xmpDate: '2026-05-01', identifier: 'SC-0042' };

describe('XMP packets', () => {
  it('round-trips Dublin Core fields with lists and escaping', () => {
    const x = buildXmp(META);
    expect(x).toMatch(/^<\?xpacket begin=/);
    expect(x).toContain('<dc:creator><rdf:Seq><rdf:li>Ana</rdf:li><rdf:li>Ben</rdf:li></rdf:Seq></dc:creator>');
    expect(x).toContain('<rdf:li>birds</rdf:li><rdf:li>dawn</rdf:li><rdf:li>forest</rdf:li>');
    expect(x).toContain('Field &lt;Notes&gt; &amp; More');
    expect(parseXmp(x)).toEqual({ ...META, keywords: 'birds, dawn, forest' });
    expect(buildXmp({ album: 'Only ID3' })).toBe(null);
  });

  it('reads attribute-form properties and the default language alternative', () => {
    const x = '<rdf:Description dc:identifier="ID-7"><dc:title><rdf:Alt><rdf:li xml:lang="fr">Titre</rdf:li><rdf:li xml:lang="x-default">Title</rdf:li></rdf:Alt></dc:title></rdf:Description>';
    expect(parseXmp(x)).toEqual({ identifier: 'ID-7', title: 'Title' });
  });

  it('pads the WAV chunk to an even length', () => {
    const c = wavXmpChunk({ description: 'x' });
    expect(String.fromCharCode(...c.subarray(0, 4))).toBe('_PMX');
    expect(c.length % 2).toBe(0);
  });
});

describe('XMP in exports', () => {
  it('WAV exports carry a _PMX chunk that opens again', async () => {
    const ch = [new Float32Array(100).fill(0.1)];
    const blob = await runExport({ options: { format: 'wav', sampleRate: 8000, channels: 1, bitDepth: 16, dither: 'none', settings: {} }, sourceRate: 8000, frames: 100, read: (at, n) => ch.map((c) => c.subarray(at, at + n)), meta: META });
    const buf = await blob.arrayBuffer();
    expect(new TextDecoder().decode(buf)).toContain('_PMX');
    expect(parseWav(buf).meta).toMatchObject(cleanMeta(META));
  });

  it('WAV exports without XMP-only fields stay as before', async () => {
    const ch = [new Float32Array(10)];
    const blob = await runExport({ options: { format: 'wav', sampleRate: 8000, channels: 1, bitDepth: 16, dither: 'none', settings: {} }, sourceRate: 8000, frames: 10, read: (at, n) => ch.map((c) => c.subarray(at, at + n)), meta: { title: 'Plain' } });
    expect(new TextDecoder().decode(await blob.arrayBuffer())).not.toContain('_PMX');
  });

  it('ID3 tags (MP3, AIFF) carry the packet in a PRIV frame', () => {
    const tag = id3v2Tag(META);
    expect(new TextDecoder().decode(tag)).toContain('PRIV');
    expect(parseId3v2(tag)).toMatchObject({ description: 'Dawn chorus, take 2', publisher: 'Sound Club', title: META.title, artist: 'Ana; Ben' });
  });
});

describe('Metadata panel XMP tab', () => {
  it('edits XMP fields as one undoable step', () => {
    expect(META_TABS.find((t) => t.id === 'xmp').fields).toContain('description');
    const app = fakeApp();
    const doc = new AudioFile({ name: 'a.wav', sampleRate: 8000, channels: [Channel.fromSamples(new Float32Array(10))] });
    app.active = doc;
    const panel = metadataPanel(app);
    const pane = [...panel.el.querySelectorAll('.meta-pane')].find((p) => p.textContent.includes('XMP packet'));
    const label = [...pane.querySelectorAll('label')].find((l) => l.textContent === 'Description:');
    const input = pane.querySelector(`#${label.htmlFor}`);
    input.value = 'A field recording';
    input.dispatchEvent(new Event('change'));
    expect(doc.state.meta.description).toBe('A field recording');
    expect(doc.history.entries.at(-1).label).toBe('Edit Metadata');
    expect([...pane.querySelectorAll('label')].map((l) => l.textContent)).toContain('Rights:');
  });
});
