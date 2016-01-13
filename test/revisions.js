var tape      = require('tape')
var multicb   = require('multicb')
var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var SSB       = require('secure-scuttlebutt')
var defaults  = require('secure-scuttlebutt/defaults')
var ssbKeys   = require('ssb-keys')
var threadlib = require('../')
var mlib = require('ssb-msgs')
var schemas   = require('ssb-msg-schemas')

var db = sublevel(level('test-patchwork-threads-flatten-noreplies', {
  valueEncoding: defaults.codec
}))
var ssb = SSB(db, defaults)

tape('getRevisions returns an array', function(t) {
  t.plan(1)
  
  var alice = ssb.createFeed(ssbKeys.generate())

  alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
    if (err) throw err

    threadlib.getRevisions(ssb, origMsg, function(revisions) {
      t.ok(revisions instanceof Array)
    })

  })
})

tape('getRevisions returns an array with the right number and type of revisions',
     function(t) {
     t.plan(2)
     
       var alice = ssb.createFeed(ssbKeys.generate())

       alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
         if (err) throw err
         
         // add revision  
         alice.add(schemas.postEdit('foo', origMsg.key, null, origMsg.key), function(err, revisionA) {
           if (err) throw err
           var msg = origMsg;
           
           threadlib.getRevisions(ssb, msg, function(revisions){
             t.equal(revisions.length, 1)
             t.ok(revisions.every(function(rev){
               return rev.value.content.type === 'post-edit'               
             }))
             t.end()
           })
         })
       })
     })
 
tape('getLatestRevision returns the latest rev of a msg', function(t) {
  t.plan(2)
  
  var alice = ssb.createFeed(ssbKeys.generate())
  
  alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
    if (err) throw err
    
    // add revision  
    alice.add(schemas.postEdit('foo', origMsg.key, null, origMsg.key), function(err, revisionA) {
      if (err) throw err
      var msg = origMsg;

      threadlib.getLatestRevision(ssb, msg, function(latestRev) {
        t.equal(latestRev.value.content.type, 'post-edit')
        t.ok(latestRev.value.timestamp > msg.value.timestamp)
        t.end()
      })
      
    })
  })  
})
 
tape('getLatestRevision returns the original msg if no revisions', function(t) {
  t.plan(1)
  
  var alice = ssb.createFeed(ssbKeys.generate())
  
  alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
    if (err) throw err
    
    threadlib.getLatestRevision(ssb, origMsg, function(latestRev) {
      t.equal(latestRev, origMsg)
      t.end()
    })
  })
})
