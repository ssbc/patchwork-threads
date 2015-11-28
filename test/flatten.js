var tape      = require('tape')
var multicb   = require('multicb')
var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var SSB       = require('secure-scuttlebutt')
var defaults  = require('secure-scuttlebutt/defaults')
var ssbKeys   = require('ssb-keys')
var threadlib = require('../')

function customTimeCreateMsg (keys, timestamp, content) {
  return ssbKeys.signObj(keys, {
    previous: null,
    author: keys.id,
    sequence: 1,
    timestamp: timestamp,
    hash: 'sha256',
    content: content,
  })
}

tape('flattenThread correctly orders despite bad timestamps', function (t) {

  var db = sublevel(level('test-patchwork-threads-flatten-order', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssbKeys.generate()
  var bob = ssbKeys.generate()
  var carla = ssbKeys.generate()
  var dan = ssbKeys.generate()

  // load test thread into ssb
  ssb.add(customTimeCreateMsg(alice, Date.now(), { type: 'post', text: 'a' }), function (err, msgA) {
    if (err) throw err

    // first reply
    ssb.add(customTimeCreateMsg(bob, Date.now(), { type: 'post', text: 'b', root: msgA.key, branch: msgA.key }), function (err, msgB) {
      if (err) throw err

      // second reply, with TS too early by an hour
      ssb.add(customTimeCreateMsg(carla, Date.now() - 1000*60*60, { type: 'post', text: 'c', root: msgA.key, branch: msgB.key }), function (err, msgC) {
        if (err) throw err

        // third reply, with TS too early by two hours
        ssb.add(customTimeCreateMsg(dan, Date.now() - 1000*60*60*2, { type: 'post', text: 'd', root: msgA.key, branch: msgC.key }), function (err, msgD) {
          if (err) throw err

          // fetch and flatten the thread
          threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
            if (err) throw err

            // check that messages are in the bad order we expect
            t.equal(thread.related[0].key, msgD.key)
            t.equal(thread.related[1].key, msgC.key)
            t.equal(thread.related[2].key, msgB.key)

            var msgs = threadlib.flattenThread(thread)
            t.equal(msgs.length, 4)
            // ensure msgs were reordered correctly
            t.equal(msgs[0].key, msgA.key)
            t.equal(msgs[1].key, msgB.key) 
            t.equal(msgs[2].key, msgC.key)
            t.equal(msgs[3].key, msgD.key)
            t.end()
          })
        })
      })
    })
  })
})