#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const catalogPath = path.join(root, 'src', 'lib', 'prompt-i18n', 'catalog.ts')
const singlePlaceholderPattern = /\{([A-Za-z0-9_]+)\}/g
const doublePlaceholderPattern = /\{\{([A-Za-z0-9_]+)\}\}/g
const unresolvedPlaceholderPattern = /\{\{?[A-Za-z0-9_]+\}?\}/g
const REQUIRED_LOCALES = ['en', 'hi', 'sa']

function fail(title, details = []) {
  console.error(`\n[prompt-ab-regression] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

function parseCatalog(text) {
  const entries = []
  const entryPattern = /pathStem:\s*'([^']+)'\s*,[\s\S]*?variableKeys:\s*\[([\s\S]*?)\]\s*,/g
  for (const match of text.matchAll(entryPattern)) {
    const pathStem = match[1]
    const rawKeys = match[2] || ''
    const keys = Array.from(rawKeys.matchAll(/'([^']+)'/g)).map((item) => item[1])
    entries.push({ pathStem, variableKeys: keys })
  }
  return entries
}

function extractPlaceholders(template) {
  const keys = new Set()
  for (const match of template.matchAll(singlePlaceholderPattern)) {
    if (match[1]) keys.add(match[1])
  }
  for (const match of template.matchAll(doublePlaceholderPattern)) {
    if (match[1]) keys.add(match[1])
  }
  return Array.from(keys)
}

function replaceAll(template, variables) {
  let rendered = template
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}|\\{${key}\\}`, 'g')
    rendered = rendered.replace(pattern, value)
  }
  return rendered
}

function setDiff(left, right) {
  const rightSet = new Set(right)
  return left.filter((item) => !rightSet.has(item))
}

if (!fs.existsSync(catalogPath)) {
  fail('catalog.ts not found', ['src/lib/prompt-i18n/catalog.ts'])
}

const catalogText = fs.readFileSync(catalogPath, 'utf8')
const entries = parseCatalog(catalogText)
if (entries.length === 0) {
  fail('failed to parse prompt catalog entries')
}

const violations = []

for (const entry of entries) {
  const templates = {}
  let skipEntry = false
  for (const locale of REQUIRED_LOCALES) {
    const localePath = path.join(root, 'lib', 'prompts', `${entry.pathStem}.${locale}.txt`)
    if (!fs.existsSync(localePath)) {
      violations.push(`missing ${locale} template: lib/prompts/${entry.pathStem}.${locale}.txt`)
      skipEntry = true
    } else {
      templates[locale] = fs.readFileSync(localePath, 'utf8')
    }
  }
  if (skipEntry) continue

  const declared = entry.variableKeys
  const placeholdersByLocale = {}
  for (const locale of REQUIRED_LOCALES) {
    placeholdersByLocale[locale] = extractPlaceholders(templates[locale])
  }

  for (const locale of REQUIRED_LOCALES) {
    const missing = setDiff(declared, placeholdersByLocale[locale])
    const extra = setDiff(placeholdersByLocale[locale], declared)
    for (const key of missing) {
      violations.push(`missing {${key}} in ${locale} template: lib/prompts/${entry.pathStem}.${locale}.txt`)
    }
    for (const key of extra) {
      violations.push(`unexpected {${key}} in ${locale} template: lib/prompts/${entry.pathStem}.${locale}.txt`)
    }
  }

  const enPlaceholders = placeholdersByLocale['en']
  for (const locale of REQUIRED_LOCALES.filter((l) => l !== 'en')) {
    const localePlaceholders = placeholdersByLocale[locale]
    const onlyInLocale = setDiff(localePlaceholders, enPlaceholders)
    const onlyInEn = setDiff(enPlaceholders, localePlaceholders)
    for (const key of onlyInLocale) {
      violations.push(`placeholder {${key}} exists only in ${locale} template: ${entry.pathStem}`)
    }
    for (const key of onlyInEn) {
      violations.push(`placeholder {${key}} missing in ${locale} template: ${entry.pathStem}`)
    }
  }

  const variables = Object.fromEntries(
    declared.map((key) => [key, `__AB_SAMPLE_${key.toUpperCase()}__`]),
  )
  for (const locale of REQUIRED_LOCALES) {
    const rendered = replaceAll(templates[locale], variables)
    const unresolved = rendered.match(unresolvedPlaceholderPattern) || []
    if (unresolved.length > 0) {
      violations.push(`unresolved placeholders in ${locale} template: ${entry.pathStem} -> ${unresolved.join(', ')}`)
    }
    for (const [key, sample] of Object.entries(variables)) {
      if (!rendered.includes(sample)) {
        violations.push(`${locale} template variable not used after render: ${entry.pathStem}.{${key}}`)
      }
    }
  }
}

if (violations.length > 0) {
  fail('A/B regression check failed', violations)
}

console.log(`[prompt-ab-regression] OK (${entries.length} templates × ${REQUIRED_LOCALES.length} locales checked)`)
