'use strict'

// Small, dependency-free calculator and linear/quadratic equation solver.
// Expressions are parsed into an AST; user input is never passed to eval().
const FUNCTIONS = new Set([
  'sqrt', 'abs', 'ceil', 'floor', 'round', 'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'log', 'ln', 'exp', 'min', 'max',
])

const OPERATORS = new Set(['+', '-', '*', '/', '%', '^', '=', '(', ')', ','])
const MAX_TOKENS = 256
const EPSILON = 1e-12

function tokenize(source) {
  const normalized = String(source)
    .replace(/π/g, 'pi')
    .replace(/√\s*(\d+(?:\.\d+)?|\([^()]*\))/g, 'sqrt($1)')
    .replace(/[×·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^')
    // Keep x as an algebra variable in equations, but accept "25 x 4" as multiply.
    .replace(/([\d)])\s*[xX]\s*(?=[\d(])/g, '$1*')

  const raw = []
  for (let i = 0; i < normalized.length;) {
    const ch = normalized[i]
    if (/\s/.test(ch)) { i++; continue }

    const number = normalized.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i)
    if (number) {
      const value = Number(number[0])
      if (!Number.isFinite(value)) throw new Error('That number is too large.')
      raw.push({ type: 'number', value })
      i += number[0].length
      continue
    }

    const word = normalized.slice(i).match(/^[a-z]+/i)
    if (word) {
      raw.push({ type: 'name', value: word[0].toLowerCase() })
      i += word[0].length
      continue
    }

    if (OPERATORS.has(ch)) {
      raw.push({ type: 'op', value: ch })
      i++
      continue
    }
    throw new Error(`I couldn't read "${ch}". Use numbers, operators, brackets, or x.`)
  }
  if (!raw.length) throw new Error('Enter a calculation or equation first.')

  // Standard implicit multiplication: 2x, 3(4 + 1), and x(x + 1).
  const tokens = []
  const endsValue = token => token.type === 'number' || token.type === 'name' || token.value === ')'
  const startsValue = token => token.type === 'number' || token.type === 'name' || token.value === '('
  for (let i = 0; i < raw.length; i++) {
    const previous = raw[i - 1]
    const current = raw[i]
    const isFunctionCall = previous?.type === 'name' && FUNCTIONS.has(previous.value) && current.value === '('
    if (previous && endsValue(previous) && startsValue(current) && !isFunctionCall) {
      tokens.push({ type: 'op', value: '*' })
    }
    tokens.push(current)
  }
  if (tokens.length > MAX_TOKENS) throw new Error('That expression is too long. Keep it under 256 parts.')
  return tokens
}

function parse(source) {
  const tokens = tokenize(source)
  let at = 0
  const peek = () => tokens[at]
  const take = value => {
    if (peek()?.value !== value) return false
    at++
    return true
  }

  function primary() {
    const token = peek()
    if (!token) throw new Error('The expression ends too early.')
    if (token.type === 'number') {
      at++
      return { type: 'number', value: token.value }
    }
    if (token.type === 'name') {
      at++
      const name = token.value
      if (take('(')) {
        if (!FUNCTIONS.has(name)) throw new Error(`Unknown math function: ${name}`)
        const args = []
        if (!take(')')) {
          do { args.push(addition()) } while (take(','))
          if (!take(')')) throw new Error('A closing bracket is missing.')
        }
        return { type: 'function', name, args }
      }
      if (name === 'x') return { type: 'variable' }
      if (name === 'pi') return { type: 'number', value: Math.PI }
      if (name === 'e') return { type: 'number', value: Math.E }
      throw new Error(`Unknown value: ${name}`)
    }
    if (take('(')) {
      const node = addition()
      if (!take(')')) throw new Error('A closing bracket is missing.')
      return node
    }
    throw new Error('Expected a number, x, function, or opening bracket.')
  }

  function power() {
    const left = primary()
    if (!take('^')) return left
    return { type: 'operator', op: '^', left, right: unary() }
  }

  function unary() {
    if (take('+')) return unary()
    if (take('-')) return { type: 'negate', child: unary() }
    return power()
  }

  function multiplication() {
    let node = unary()
    while (['*', '/', '%'].includes(peek()?.value)) {
      const op = tokens[at++].value
      node = { type: 'operator', op, left: node, right: unary() }
    }
    return node
  }

  function addition() {
    let node = multiplication()
    while (peek()?.value === '+' || peek()?.value === '-') {
      const op = tokens[at++].value
      node = { type: 'operator', op, left: node, right: multiplication() }
    }
    return node
  }

  const tree = addition()
  if (at !== tokens.length) {
    if (peek()?.value === '=') throw new Error('Only one equals sign is allowed in an equation.')
    throw new Error('Check the operators and brackets in that expression.')
  }
  return tree
}

function cleanPoly(poly) {
  return poly.map(value => Math.abs(value) < EPSILON ? 0 : value)
}

function polyAdd(a, b, sign = 1) {
  return cleanPoly(a.map((value, i) => value + sign * b[i]))
}

function polyMultiply(a, b) {
  const out = [0, 0, 0, 0, 0]
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  if (out.slice(3).some(value => Math.abs(value) >= EPSILON)) {
    throw new Error('I can solve equations through x². This one has a higher power of x.')
  }
  return cleanPoly(out.slice(0, 3))
}

function scalarFunction(name, values) {
  const oneArg = new Set(['sqrt', 'abs', 'ceil', 'floor', 'round', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'ln', 'exp'])
  if (oneArg.has(name) && values.length !== 1) throw new Error(`${name}() needs one number.`)
  if ((name === 'min' || name === 'max') && values.length < 1) throw new Error(`${name}() needs at least one number.`)
  const value = ({
    sqrt: Math.sqrt, abs: Math.abs, ceil: Math.ceil, floor: Math.floor,
    round: Math.round, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    log: Math.log10, ln: Math.log, exp: Math.exp,
    min: Math.min, max: Math.max,
  })[name](...values)
  if (!Number.isFinite(value)) throw new Error('That operation has no finite real-number answer.')
  return value
}

function toPolynomial(node) {
  if (node.type === 'number') return [node.value, 0, 0]
  if (node.type === 'variable') return [0, 1, 0]
  if (node.type === 'negate') return cleanPoly(toPolynomial(node.child).map(value => -value))
  if (node.type === 'function') {
    const args = node.args.map(toPolynomial)
    if (args.some(poly => poly[1] || poly[2])) throw new Error('Math functions can be used with numbers, not x.')
    return [scalarFunction(node.name, args.map(poly => poly[0])), 0, 0]
  }

  const left = toPolynomial(node.left)
  const right = toPolynomial(node.right)
  switch (node.op) {
    case '+': return polyAdd(left, right)
    case '-': return polyAdd(left, right, -1)
    case '*': return polyMultiply(left, right)
    case '/':
      if (right[1] || right[2]) throw new Error('An equation cannot divide by an expression containing x.')
      if (!right[0]) throw new Error('Division by zero is not defined.')
      return cleanPoly(left.map(value => value / right[0]))
    case '%':
      if (left[1] || left[2] || right[1] || right[2]) throw new Error('% can only be used with numbers.')
      if (!right[0]) throw new Error('Division by zero is not defined.')
      return [left[0] % right[0], 0, 0]
    case '^': {
      if (right[1] || right[2]) throw new Error('The power must be a number, not x.')
      const exponent = right[0]
      if (left[1] || left[2]) {
        if (!Number.isInteger(exponent) || exponent < 0 || exponent > 2) {
          throw new Error('Equations with x can use powers 0, 1, or 2.')
        }
        if (exponent === 0) return [1, 0, 0]
        if (exponent === 1) return left
        return polyMultiply(left, left)
      }
      const result = left[0] ** exponent
      if (!Number.isFinite(result)) throw new Error('That power has no finite real-number answer.')
      return [result, 0, 0]
    }
    default: throw new Error('Unsupported math operator.')
  }
}

function formatNumber(value) {
  if (Math.abs(value) < EPSILON) value = 0
  const rounded = Number(value.toPrecision(12))
  return String(rounded)
}

function formatExact(value) {
  if (Math.abs(value - Math.round(value)) < 1e-10) return formatNumber(Math.round(value))
  const sign = value < 0 ? -1 : 1
  const target = Math.abs(value)
  let bestNumerator = Math.round(target)
  let bestDenominator = 1
  let bestError = Math.abs(target - bestNumerator)
  for (let denominator = 2; denominator <= 10000; denominator++) {
    const numerator = Math.round(target * denominator)
    const error = Math.abs(target - numerator / denominator)
    if (error < bestError) {
      bestError = error
      bestNumerator = numerator
      bestDenominator = denominator
      if (error < 1e-12) break
    }
  }
  if (bestError < 1e-10 && bestDenominator > 1) {
    const divisor = gcd(bestNumerator, bestDenominator)
    return `${sign < 0 ? '-' : ''}${bestNumerator / divisor}/${bestDenominator / divisor}`
  }
  return formatNumber(value)
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b]
  return a || 1
}

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4 }
const DISPLAY_OP = { '*': '×', '/': '÷', '^': '^', '%': '%' }

function render(node, parentPrecedence = 0, isRight = false, parentOp = '') {
  if (node.type === 'number') return formatNumber(node.value)
  if (node.type === 'variable') return 'x'
  if (node.type === 'negate') {
    const text = `−${render(node.child, 3)}`
    return parentPrecedence > 3 ? `(${text})` : text
  }
  if (node.type === 'function') return `${node.name}(${node.args.map(arg => render(arg)).join(', ')})`
  const p = PRECEDENCE[node.op]
  const left = render(node.left, p, false, node.op)
  const right = render(node.right, p, true, node.op)
  const text = `${left} ${DISPLAY_OP[node.op] || node.op} ${right}`
  const needsParens = p < parentPrecedence ||
    (isRight && p === parentPrecedence && ['-', '/', '%', '^'].includes(parentOp)) ||
    (!isRight && p === parentPrecedence && parentOp === '^')
  return needsParens ? `(${text})` : text
}

function evaluate(node) {
  const poly = toPolynomial(node)
  if (poly[1] || poly[2]) throw new Error('Add an equals sign so I can solve for x, for example: 2x + 3 = 7.')
  return poly[0]
}

function reduceOnce(node) {
  if (node.type === 'operator') {
    const left = reduceOnce(node.left)
    if (left.changed) return { node: { ...node, left: left.node }, changed: true }
    const right = reduceOnce(node.right)
    if (right.changed) return { node: { ...node, right: right.node }, changed: true }
  } else if (node.type === 'negate') {
    const child = reduceOnce(node.child)
    if (child.changed) return { node: { ...node, child: child.node }, changed: true }
  } else if (node.type === 'function') {
    for (let i = 0; i < node.args.length; i++) {
      const child = reduceOnce(node.args[i])
      if (child.changed) {
        const args = node.args.slice()
        args[i] = child.node
        return { node: { ...node, args }, changed: true }
      }
    }
  }

  try {
    const value = evaluate(node)
    return { node: { type: 'number', value }, changed: node.type !== 'number' }
  } catch {
    return { node, changed: false }
  }
}

function formatPolynomial(poly) {
  const terms = []
  for (let degree = 2; degree >= 0; degree--) {
    const coefficient = poly[degree] || 0
    if (Math.abs(coefficient) < EPSILON) continue
    const negative = coefficient < 0
    const magnitude = Math.abs(coefficient)
    const variable = degree === 2 ? 'x²' : degree === 1 ? 'x' : ''
    const part = variable
      ? `${magnitude === 1 ? '' : formatNumber(magnitude)}${variable}`
      : formatNumber(magnitude)
    terms.push({ negative, part })
  }
  if (!terms.length) return '0'
  return terms.map((term, i) => `${i ? (term.negative ? ' − ' : ' + ') : (term.negative ? '−' : '')}${term.part}`).join('')
}

function solveEquation(left, right, original) {
  const difference = polyAdd(toPolynomial(left), toPolynomial(right), -1)
  const [c, b, a] = difference
  const steps = [original, `${formatPolynomial(difference)} = 0`]
  const answerLabel = 'Answer'

  if (!a && !b) {
    const answer = Math.abs(c) < EPSILON ? 'Every value of x is a solution.' : 'There is no solution.'
    steps.push(answer)
    return { answer, steps, label: answerLabel }
  }

  if (!a) {
    const rhs = -c
    const solution = rhs / b
    steps.push(`${formatNumber(b)}x = ${formatNumber(rhs)}`)
    steps.push(`x = ${formatNumber(rhs)} ÷ ${formatNumber(b)}`)
    steps.push(`x = ${formatExact(solution)}`)
    return { answer: `x = ${formatExact(solution)}`, steps, label: answerLabel }
  }

  const discriminant = b * b - 4 * a * c
  steps.push(`a = ${formatNumber(a)}, b = ${formatNumber(b)}, c = ${formatNumber(c)}`)
  steps.push(`D = b² − 4ac = ${formatNumber(discriminant)}`)
  if (discriminant < -EPSILON) {
    const answer = 'No real solutions (the discriminant is below zero).'
    steps.push(answer)
    return { answer, steps, label: answerLabel }
  }

  const root = Math.sqrt(Math.max(0, discriminant))
  const x1 = (-b + root) / (2 * a)
  const x2 = (-b - root) / (2 * a)
  steps.push('x = (−b ± √D) ÷ (2a)')
  if (Math.abs(discriminant) < EPSILON) {
    steps.push(`x = ${formatExact(x1)}`)
    return { answer: `x = ${formatExact(x1)}`, steps, label: answerLabel }
  }
  steps.push(`x₁ = ${formatNumber(x1)}`)
  steps.push(`x₂ = ${formatNumber(x2)}`)
  const exactRoots = Number.isInteger(root)
    ? `x₁ = ${formatExact(x1)}, x₂ = ${formatExact(x2)}`
    : `x₁ = ${formatNumber(x1)}, x₂ = ${formatNumber(x2)}`
  return { answer: exactRoots, steps, label: answerLabel }
}

function solveMath(input) {
  const expression = String(input || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!expression) throw new Error('Send an expression or equation after the command.')
  if (expression.length > 160) throw new Error('Please keep the expression under 160 characters.')

  const equals = expression.split('=')
  if (equals.length > 2) throw new Error('Use one equals sign per equation.')
  if (equals.length === 2) {
    if (!equals[0].trim() || !equals[1].trim()) throw new Error('Write both sides of the equation.')
    return solveEquation(parse(equals[0]), parse(equals[1]), expression)
  }

  const tree = parse(expression)
  const result = evaluate(tree)
  const steps = [render(tree)]

  // Show repeated addition for the common whole-number multiplication case.
  if (tree.type === 'operator' && tree.op === '*') {
    const left = evaluate(tree.left)
    const right = evaluate(tree.right)
    const count = Number.isInteger(right) && right > 1 && right <= 10 ? right
      : Number.isInteger(left) && left > 1 && left <= 10 ? left : 0
    const value = count === right ? left : right
    if (count && Number.isFinite(value)) steps.push(Array(count).fill(formatNumber(value)).join(' + '))
  } else {
    let current = tree
    for (let i = 0; i < 20; i++) {
      const reduced = reduceOnce(current)
      if (!reduced.changed) break
      current = reduced.node
      const line = render(current)
      if (line !== steps[steps.length - 1]) steps.push(line)
      if (current.type === 'number') break
    }
  }

  const final = formatNumber(result)
  if (steps[steps.length - 1] !== final) steps.push(final)
  return { answer: final, steps, label: 'Answer' }
}

module.exports = { solveMath, formatNumber }
