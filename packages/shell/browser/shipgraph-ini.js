// Ship graph .config.ini mods in the 岛风GO format (reference: 74EO's EOPlugin-LocalCacher).
// [graph] <field>_left/_top replace api_mst_shipgraph api_<field>[0]/[1]; empty or missing keys keep
// the server's value. [info] ship_name / getmes replace the matching api_mst_ship entry.

const FIELDS = [
  'boko_n',
  'boko_d',
  'kaisyu_n',
  'kaisyu_d',
  'kaizo_n',
  'kaizo_d',
  'map_n',
  'map_d',
  'ensyuf_n',
  'ensyuf_d',
  'ensyue_n',
  'battle_n',
  'battle_d',
  'weda',
  'wedb',
]

// ini files come from Chinese and Japanese tools, so accept GBK when it isn't valid UTF-8
function decodeIni(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gbk').decode(buf)
  }
}

function parseIni(text) {
  const out = {}
  let section = ''
  for (let line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    line = line.trim()
    if (!line || line[0] === ';' || line[0] === '#') continue
    const header = line.match(/^\[(.+)\]$/)
    if (header) {
      section = header[1].trim().toLowerCase()
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    out[section] = out[section] || {}
    out[section][line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim()
  }
  return out
}

// body is the raw "svdata={...}" response; inis maps api_filename -> parsed ini.
// Returns the patched body and how many ships changed, or null when nothing applies.
function applyShipInis(body, inis) {
  if (!body.startsWith('svdata=')) return null
  const data = JSON.parse(body.slice('svdata='.length))
  const graphs = data.api_data && data.api_data.api_mst_shipgraph
  const ships = data.api_data && data.api_data.api_mst_ship
  if (!Array.isArray(graphs)) return null

  let count = 0
  for (const graph of graphs) {
    const ini = graph.api_sortno !== 0 && inis.get(graph.api_filename)
    if (!ini) continue
    const values = ini.graph || {}
    for (const field of FIELDS) {
      const coords = graph['api_' + field]
      if (!Array.isArray(coords)) continue
      ;['left', 'top'].forEach((side, i) => {
        const value = values[`${field}_${side}`]
        if (/^-?\d+$/.test(value || '')) coords[i] = Number(value)
      })
    }
    const info = ini.info || {}
    const ship = Array.isArray(ships) && ships.find((s) => s.api_id === graph.api_id)
    if (ship && info.ship_name) ship.api_name = info.ship_name
    if (ship && info.getmes) ship.api_getmes = info.getmes
    count++
  }
  return count ? { body: 'svdata=' + JSON.stringify(data), count } : null
}

module.exports = { decodeIni, parseIni, applyShipInis }
