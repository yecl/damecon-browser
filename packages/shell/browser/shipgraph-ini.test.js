// node packages/shell/browser/shipgraph-ini.test.js
const assert = require('assert')
const { decodeIni, parseIni, applyShipInis } = require('./shipgraph-ini')

const body =
  'svdata=' +
  JSON.stringify({
    api_result: 1,
    api_data: {
      api_mst_ship: [
        { api_id: 467, api_name: '瑞鶴改二甲', api_getmes: 'orig' },
        { api_id: 1, api_name: '睦月', api_getmes: 'x' },
      ],
      api_mst_shipgraph: [
        {
          api_id: 467,
          api_sortno: 50,
          api_filename: 'qgrxbhuvtrbf',
          api_boko_n: [10, 20],
          api_boko_d: [1, 2],
          api_weda: [5, 6],
        },
        { api_id: 1, api_sortno: 0, api_filename: 'skipme', api_boko_n: [0, 0] },
      ],
    },
  })

const ini = parseIni(
  '﻿; comment\r\n[info]\r\nship_name=决战瑞鹤\r\n[graph]\r\nboko_n_left=-35\r\nboko_n_top=\r\nboko_d_left=abc\r\nweda_top=77\r\n',
)
assert.deepStrictEqual(ini, {
  info: { ship_name: '决战瑞鹤' },
  graph: { boko_n_left: '-35', boko_n_top: '', boko_d_left: 'abc', weda_top: '77' },
})

const out = applyShipInis(
  body,
  new Map([
    ['qgrxbhuvtrbf', ini],
    ['skipme', ini],
  ]),
)
assert.strictEqual(out.count, 1)
assert(out.body.startsWith('svdata='))
const data = JSON.parse(out.body.slice(7)).api_data
const graph = data.api_mst_shipgraph[0]
assert.deepStrictEqual(graph.api_boko_n, [-35, 20]) // empty top keeps the server value
assert.deepStrictEqual(graph.api_boko_d, [1, 2]) // non-numeric value is ignored
assert.deepStrictEqual(graph.api_weda, [5, 77])
assert.strictEqual(data.api_mst_ship[0].api_name, '决战瑞鹤')
assert.strictEqual(data.api_mst_ship[0].api_getmes, 'orig')
assert.deepStrictEqual(data.api_mst_shipgraph[1].api_boko_n, [0, 0]) // api_sortno 0 is skipped
assert.strictEqual(data.api_mst_ship[1].api_name, '睦月')

assert.strictEqual(applyShipInis(body, new Map()), null)
assert.strictEqual(applyShipInis('{"not":"svdata"}', new Map([['qgrxbhuvtrbf', ini]])), null)

// GBK-encoded ini ("决战" is 0xBE 0xF6 0xD5 0xBD in GBK)
const gbk = Buffer.concat([
  Buffer.from('[info]\nship_name='),
  Buffer.from([0xbe, 0xf6, 0xd5, 0xbd]),
])
assert.strictEqual(parseIni(decodeIni(gbk)).info.ship_name, '决战')
assert.strictEqual(decodeIni(Buffer.from('ship_name=瑞鶴')), 'ship_name=瑞鶴')

console.log('shipgraph-ini ok')
