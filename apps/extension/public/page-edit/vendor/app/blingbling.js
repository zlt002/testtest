import $$ from './vendor-deps/blingblingjs.js'

export default function $(query, $context = document) {
  return query.nodeType !== undefined ? $$([query]) : $$(query) 
}
