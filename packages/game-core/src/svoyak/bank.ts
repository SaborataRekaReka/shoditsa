import type { Catalog } from '@shoditsa/contracts/svoyak'

export type BankQuestion = {
  id: string; hash: string; themeId: string; theme: string; topic: string; packId: number; packTitle: string
  prompt: string; answer: string; aliases: string[]; note: string; source: string; difficulty: number; age: number
  duplicateIds: string[]
}
export type Bank = { catalog: Catalog; questions: BankQuestion[] }
export interface QuestionBank { load(): Promise<Bank>; validate(questions: BankQuestion[]): Promise<void> }

