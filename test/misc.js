var tape      = require('tape')
var multicb   = require('multicb')
var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var SSB       = require('secure-scuttlebutt')
var defaults  = require('secure-scuttlebutt/defaults')
var ssbKeys   = require('ssb-keys')
var threadlib = require('../')
var mlib      = require('ssb-msgs')
var schemas   = require('ssb-msg-schemas')

tape('fetchThreadRootID returns a thread\'s own key if it is root', function(t) {
  t.plan(1)
  var db = sublevel(level('test-patchwork-threads-root-id-self', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)


  var alice = ssb.createFeed(ssbKeys.generate())

  alice.add({ type: 'post', text: 'a' }, function (err, msg) {
    if (err) throw err
    threadlib.fetchThreadRootID(ssb, msg.key, function(err, rootThreadKey) {
      t.equal(rootThreadKey, msg.key)
      t.end()
    })
  })
})
