// Node 24 diagnostic only: parse the source and server-render changed screens.
// This does NOT replace a Vite build or browser/visual QA. The tiny JSX adapter
// is local to this diagnostic; it is never used in the shipped application.
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync, types as t } from '@babel/core'
import { parse } from '@babel/parser'
import React from 'react'
import { renderToString } from 'react-dom/server'

let parsed = 0
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const filename = path.join(dir, name)
    if (fs.statSync(filename).isDirectory()) walk(filename)
    else if (/\.(js|jsx)$/.test(filename)) {
      parse(fs.readFileSync(filename, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
      parsed++
    }
  }
}
walk(fileURLToPath(new URL('../src', import.meta.url)))
console.log(`Parsed ${parsed} JavaScript/JSX files`)
function tag(node) {
  return node.type === 'JSXIdentifier'
    ? /^[a-z]/.test(node.name) ? t.stringLiteral(node.name) : t.identifier(node.name)
    : t.memberExpression(tag(node.object), t.identifier(node.property.name))
}
function children(nodes) {
  return nodes.flatMap((node) => node.type === 'JSXText'
    ? node.value.trim() ? [t.stringLiteral(node.value.replace(/\s+/g, ' '))] : []
    : node.type === 'JSXExpressionContainer' ? node.expression.type === 'JSXEmptyExpression' ? [] : [node.expression] : [node])
}
const jsxAdapter = () => ({ visitor: {
  JSXElement: { exit(p) {
    const element = p.node
    const props = element.openingElement.attributes.map((a) => a.type === 'JSXSpreadAttribute' ? t.spreadElement(a.argument)
      : t.objectProperty(t.stringLiteral(a.name.name), a.value == null ? t.booleanLiteral(true) : a.value.type === 'JSXExpressionContainer' ? a.value.expression : a.value))
    p.replaceWith(t.callExpression(t.memberExpression(t.identifier('__jsxReact'), t.identifier('createElement')),
      [tag(element.openingElement.name), props.length ? t.objectExpression(props) : t.nullLiteral(), ...children(element.children)]))
  } },
  JSXFragment: { exit(p) {
    p.replaceWith(t.callExpression(t.memberExpression(t.identifier('__jsxReact'), t.identifier('createElement')),
      [t.memberExpression(t.identifier('__jsxReact'), t.identifier('Fragment')), t.nullLiteral(), ...children(p.node.children)]))
  } },
} })
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL)
      if (specifier.endsWith('?raw')) return { url: url.href, shortCircuit: true }
      for (const extension of ['.js', '.jsx']) if (fs.existsSync(fileURLToPath(url) + extension)) return { url: url.href + extension, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('?raw')) return { format: 'module', source: 'export default ' + JSON.stringify(fs.readFileSync(fileURLToPath(url.split('?')[0]), 'utf8')), shortCircuit: true }
    if (/\.(jpg|png|svg|webp)$/.test(url)) return { format: 'module', source: 'export default ' + JSON.stringify(url), shortCircuit: true }
    if (url.endsWith('.jsx')) return { format: 'module', source: 'import __jsxReact from "react";\n' + transformSync(fs.readFileSync(fileURLToPath(url), 'utf8'), {
      configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] }, plugins: [jsxAdapter],
    }).code, shortCircuit: true }
    return next(url, context)
  },
})

const { newProfileDefaults } = await import('../src/db/profile.js')
const { preparePlanGeneration } = await import('../src/services/planning/planGeneration.js')
const profile = newProfileDefaults({ name: 'Smoke test', sport: 'triathlon', trainingFitness: { run: { value: 240 }, swim: { level: 'new' } }, onboardingCompleted: true })
const plan = preparePlanGeneration({ profile, recentSessions: [], weekPhases: [], checkIn: { recovery: 'normal', painLevel: 'none' }, today: new Date('2026-08-31T12:00:00') })
if (!plan.prompt.includes('endurancePrescriptionId')) throw new Error('Missing endurance contract in prompt')
console.log(`Generated prompt (${plan.prompt.length} characters)`)
for (const [name, props] of [
  ['FitnessSettings', { profile, onChange: () => {}, sessions: [] }],
  ['ProfileSheet', { profile, allSessions: [], onClose: () => {} }],
  ['PlanGenerationWizardSheet', { profile, allSessions: [], weekPhases: [], onClose: () => {} }],
  ['RoadToRaceCard', { profile, sessions: [], weekPhases: [] }],
  ['SessionDetailSheet', { session: { ...plan.skeleton.weeks[0].sessions.find((s) => s.endurancePrescription?.feedbackRequired), id: 1, title: 'Calibration', sets: [], athleteFeedback: '' }, onClose: () => {} }],
]) {
  const { default: Component } = await import(`../src/components/${name}.jsx`)
  const html = renderToString(React.createElement(Component, props))
  if (!html.length) throw new Error(`Empty ${name}`)
  console.log(`Server-rendered ${name} (${html.length} characters)`)
}
