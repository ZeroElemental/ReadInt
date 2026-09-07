/**
 * The ONLY module that touches IndexedDB.
 *
 * Kept that way on purpose: when cloud sync arrives, swapping in a sync-aware
 * repository is one file, not a codebase sweep. Annotations already carry a
 * stable id and updatedAt, so last-write-wins merging is a function, not a
 * migration.
 */

import Dexie, { type Table } from 'dexie'
import type {
  Annotation,
  DocumentRecord,
  LookupRecord,
  PageTextRecord,
  Settings,
} from './types.ts'

class ReadIntDB extends Dexie {
  documents!: Table<DocumentRecord, string>
  pageText!: Table<PageTextRecord, [string, number]>
  annotations!: Table<Annotation, string>
  lookups!: Table<LookupRecord, [string, string]>
  settings!: Table<{ key: string; value: unknown }, string>
  /** Crash recovery only. Never merged silently — the user is offered it. */
  drafts!: Table<{ docId: string; annotations: Annotation[]; savedAt: number }, string>

  constructor() {
    super('readint')
    this.version(1).stores({
      documents: 'id, name, addedAt, lastOpenedAt',
      pageText: '[docId+pageIndex], docId',
      annotations: 'id, [docId+pageIndex], docId, updatedAt',
      lookups: '[term+docId]',
      settings: 'key',
      drafts: 'docId',
    })
  }
}

export const db = new ReadIntDB()

export const DEFAULT_SETTINGS: Settings = {
  readingDirection: 'ltr',
  magnifier: 'lens',
  magFactor: 2.5,
  highlightColor: '#ffe066',
  inkColor: '#1f2933',
  thickness: 2,
  spread: true,
}

export const listDocuments = () =>
  db.documents.orderBy('lastOpenedAt').reverse().toArray()

export const getDocument = (id: string) => db.documents.get(id)

export const annotationsForPage = (docId: string, pageIndex: number) =>
  db.annotations.where('[docId+pageIndex]').equals([docId, pageIndex]).toArray()

export const annotationsForDoc = (docId: string) =>
  db.annotations.where('docId').equals(docId).toArray()

export const getPageText = (docId: string, pageIndex: number) =>
  db.pageText.get([docId, pageIndex])

export const putPageText = (record: PageTextRecord) => db.pageText.put(record)

export const getLookup = (term: string, docId: string) =>
  db.lookups.get([term, docId])

export const putLookup = (record: LookupRecord) => db.lookups.put(record)

/**
 * Explicit save (Ctrl+S / the Save button). One transaction so a half-written
 * page can never survive a crash.
 */
export async function saveAnnotations(
  docId: string,
  annotations: Annotation[],
  deletedIds: string[] = [],
): Promise<void> {
  await db.transaction('rw', db.annotations, db.drafts, async () => {
    if (deletedIds.length) await db.annotations.bulkDelete(deletedIds)
    if (annotations.length) await db.annotations.bulkPut(annotations)
    await db.drafts.delete(docId) // saved for real; the draft is now noise
  })
}

/** Autosave target. Separate from the saved state so "saved" stays meaningful. */
export const putDraft = (docId: string, annotations: Annotation[]) =>
  db.drafts.put({ docId, annotations, savedAt: Date.now() })

export const getDraft = (docId: string) => db.drafts.get(docId)

export const discardDraft = (docId: string) => db.drafts.delete(docId)

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get('settings')
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
}

export const saveSettings = (value: Settings) =>
  db.settings.put({ key: 'settings', value })
