import path from 'node:path'
import process from 'node:process'
import { validateGeneratedData } from '../shared/data-schema.mjs'

const rootDir = process.cwd()

const run = async () => {
  const errors = await validateGeneratedData(rootDir)
  if (!errors.length) {
    console.log('Generated data validation passed')
    return
  }

  console.error('Generated data validation failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
