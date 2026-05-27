import VisBug from './components/vis-bug/vis-bug.element.js'
import { metaKey } from './utilities/index.js'

if ('ontouchstart' in document.documentElement)
  document.getElementById('mobile-info').style.display = ''

if (metaKey === 'ctrl')
  [...document.querySelectorAll('kbd')]
    .forEach(node => {
      node.textContent = node.textContent.replace('cmd','ctrl')
      node.textContent = node.textContent.replace('opt','alt')
    })
