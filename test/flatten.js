var tape      = require('tape')
var multicb   = require('multicb')
var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var SSB       = require('secure-scuttlebutt')
var defaults  = require('secure-scuttlebutt/defaults')
var ssbKeys   = require('ssb-keys')
var threadlib = require('../')

tape('flattenThread works without replies', function (t) {

  var db = sublevel(level('test-patchwork-threads-flatten-noreplies', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssb.createFeed(ssbKeys.generate())

  // load test thread into ssb
  alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
    if (err) throw err

    // fetch and flatten the thread
    threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
      if (err) throw err

      var msgs = threadlib.flattenThread(thread)
      t.equal(msgs.length, 1)
      // ensure msgs were interpretted correctly
      t.equal(msgs[0].key, msgA.key)
      t.end()
    })
  })
})

tape('flattenThread works when branch link is missing', function (t) {

  var db = sublevel(level('test-patchwork-threads-flatten-nobranch', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssb.createFeed(ssbKeys.generate())
  var bob = ssb.createFeed(ssbKeys.generate())
  var carla = ssb.createFeed(ssbKeys.generate())

  // load test thread into ssb
  alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
    if (err) throw err

    // first reply
    bob.add({ type: 'post', text: 'b', root: msgA.key }, function (err, msgB) {
      if (err) throw err

      // second reply
      alice.add({ type: 'post', text: 'c', root: msgA.key, branch: msgB.key }, function (err, msgC) {
        if (err) throw err

        // fetch and flatten the thread
        threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
          if (err) throw err

          var msgs = threadlib.flattenThread(thread)
          t.equal(msgs.length, 3)
          // ensure msgs were interpretted correctly
          t.equal(msgs[0].key, msgA.key)
          t.equal(msgs[1].key, msgB.key) 
          t.equal(msgs[2].key, msgC.key)
          t.end()
        })
      })
    })
  })
})

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

tape('flattenThread correctly orders despite bad timestamps, pt 2', function (t) {

  var db = sublevel(level('test-patchwork-threads-flatten-order-2', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssbKeys.generate()
  var bob = ssbKeys.generate()
  var carla = ssbKeys.generate()
  var dan = ssbKeys.generate()

  // load test thread into ssb
  // root with TS ahead by an hour
  ssb.add(customTimeCreateMsg(alice, Date.now() + 1000*60*60, { type: 'post', text: 'a' }), function (err, msgA) {
    if (err) throw err

    // reply with correct TS
    ssb.add(customTimeCreateMsg(bob, Date.now(), { type: 'post', text: 'b', root: msgA.key, branch: msgA.key }), function (err, msgB) {
      if (err) throw err

      // second reply, with TS too early by 2 hours
      ssb.add(customTimeCreateMsg(carla, Date.now() + 1000*60*60*2, { type: 'post', text: 'c', root: msgA.key, branch: msgB.key }), function (err, msgC) {
        if (err) throw err

        // third reply, correct TS
        ssb.add(customTimeCreateMsg(dan, Date.now(), { type: 'post', text: 'd', root: msgA.key, branch: msgC.key }), function (err, msgD) {
          if (err) throw err

          // fetch and flatten the thread
          threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
            if (err) throw err

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

tape('flattenThread weaves mentions into the thread', function (t) {

  var db = sublevel(level('test-patchwork-threads-flatten-mentions', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssb.createFeed(ssbKeys.generate())
  var bob = ssb.createFeed(ssbKeys.generate())
  var carla = ssb.createFeed(ssbKeys.generate())

  // load test thread into ssb
  alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
    if (err) throw err

    // first reply
    bob.add({ type: 'post', text: 'b', root: msgA.key, branch: msgA.key }, function (err, msgB) {
      if (err) throw err

      // mention
      carla.add({ type: 'post', text: 'c', mentions: msgB.key }, function (err, msgC) {
        if (err) throw err

        // second reply, AND a mention
        alice.add({ type: 'post', text: 'd', root: msgA.key, branch: msgB.key, mentions: msgA.key }, function (err, msgD) {
          if (err) throw err

          // fetch and flatten the thread
          threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
            if (err) throw err

            var msgs = threadlib.flattenThread(thread)
            t.equal(msgs.length, 4)
            // ensure msgs were interpretted correctly
            t.equal(msgs[0].key, msgA.key)
            t.equal(!!msgs[0].isMention, false)
            t.equal(msgs[1].key, msgB.key) 
            t.equal(!!msgs[1].isMention, false)
            t.equal(msgs[2].key, msgC.key)
            t.equal(!!msgs[2].isMention, true) // is a mention!
            t.equal(msgs[3].key, msgD.key)
            t.equal(!!msgs[3].isMention, false) // is NOT a mention!
            t.end()
          })
        })
      })
    })
  })
})

tape('flattenThread detects missing parents', function (t) {

  var db = sublevel(level('test-patchwork-threads-flatten-missing-parents', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssb.createFeed(ssbKeys.generate())
  var bob = ssb.createFeed(ssbKeys.generate())
  var carla = ssb.createFeed(ssbKeys.generate())

  // load test thread into ssb
  alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
    if (err) throw err
    bob.add({ type: 'post', text: 'b', root: msgA.key, branch: msgA.key }, function (err, msgB) {
      if (err) throw err
      carla.add({ type: 'post', text: 'c', root: msgA.key, branch: msgB.key }, function (err, msgC) {
        if (err) throw err

        // fetch thread
        threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
          if (err) throw err

          // delete the first reply
          // 0 & 1 are msgB (0 for root and 1 for branch) delete them both
          thread.related.splice(0, 2)

          // now flatten
          var msgs = threadlib.flattenThread(thread)
          t.equal(msgs.length, 3)
          // ensure msgs were interpretted correctly
          t.equal(msgs[0].key, msgA.key)
          t.equal(!!msgs[0].isNotFound, false)
          t.equal(msgs[1].key, msgB.key) 
          t.equal(!!msgs[1].isNotFound, true) // our missing post
          t.equal(msgs[2].key, msgC.key)
          t.equal(!!msgs[2].isNotFound, false)
          t.end()
        })
      })
    })
  })
})
tape('flattenThread links to missing roots', function (t) {

  var db = sublevel(level('test-patchwork-threads-flatten-missing-roots', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssb.createFeed(ssbKeys.generate())
  var bob = ssb.createFeed(ssbKeys.generate())
  var carla = ssb.createFeed(ssbKeys.generate())

  // load test thread into ssb
  alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
    if (err) throw err
    bob.add({ type: 'post', text: 'b', root: msgA.key, branch: msgA.key }, function (err, msgB) {
      if (err) throw err
      carla.add({ type: 'post', text: 'c', root: msgA.key, branch: msgB.key }, function (err, msgC) {
        if (err) throw err

        // fetch thread
        threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
          if (err) throw err

          // change the root
          var thread = thread.related[0]

          // now flatten
          var msgs = threadlib.flattenThread(thread)
          t.equal(msgs.length, 3)
          // ensure msgs were interpretted correctly
          t.equal(msgs[0].key, msgA.key)
          t.equal(!!msgs[0].isLink, true) // our absent father
          t.equal(msgs[1].key, msgB.key) 
          t.equal(!!msgs[1].isLink, false)
          t.equal(msgs[2].key, msgC.key)
          t.equal(!!msgs[2].isLink, false)
          t.end()
        })
      })
    })
  })
})

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