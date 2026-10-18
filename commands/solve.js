'use strict'

const calculator = require('./calc')

module.exports = {
  pattern: 'solve',
  alias: ['equation'],
  category: 'utility',
  desc: 'Solve a linear or quadratic equation and show the working',
  usage: '.solve <equation>',
  run: calculator.run,
}
