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

tape('getRevisions returns an array', function(t) {
  t.plan(1)
  var db = sublevel(level('test-patchwork-threads-revision-array', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)


  var alice = ssb.createFeed(ssbKeys.generate())

  alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
    if (err) throw err

    threadlib.getRevisions(ssb, origMsg, function(err, revisions) {
      t.ok(revisions instanceof Array)
    })

  })
})

tape('getRevisions returns an array with the right number and type of revisions',
     function(t) {
     t.plan(2)

     var db = sublevel(level('test-patchwork-threads-revision-array-count', {
       valueEncoding: defaults.codec
     }))
     var ssb = SSB(db, defaults)

     
       var alice = ssb.createFeed(ssbKeys.generate())

       alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
         if (err) throw err
         
         // add revision  
         alice.add(schemas.postEdit('foo', origMsg.key, null, origMsg.key), function(err, revisionA) {
           if (err) throw err
           var msg = origMsg;
           
           threadlib.getRevisions(ssb, msg, function(err, revisions){
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
  
  var db = sublevel(level('test-patchwork-threads-latest-rev', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)
  var alice = ssb.createFeed(ssbKeys.generate())
  
  alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
    if (err) throw err
    
    // add revision  
    alice.add(schemas.postEdit('foo', origMsg.key, null, origMsg.key), function(err, revisionA) {
      if (err) throw err
      var msg = origMsg;

      threadlib.getLatestRevision(ssb, msg, function(err, latestRev) {
        t.equal(latestRev.value.content.type, 'post-edit')
        t.ok(latestRev.value.timestamp > msg.value.timestamp)
        t.end()
      })
      
    })
  })  
})
 
tape('getLatestRevision returns the original msg if no revisions', function(t) {
  t.plan(1)
  var db = sublevel(level('test-patchwork-threads-no-rev', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)
  var alice = ssb.createFeed(ssbKeys.generate())
  
  alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
    if (err) throw err
    
    threadlib.getLatestRevision(ssb, origMsg, function(err, latestRev) {
      t.equal(latestRev, origMsg)
      t.end()
    })
  })
})

tape('reviseFlatThread returns the original message if only one is present', 
  function(t) {
    t.plan(2)

    var db = sublevel(level('test-patchwork-threads-revise-single-msg', {
      valueEncoding: defaults.codec
    }))
    var ssb = SSB(db, defaults)

    var alice = ssb.createFeed(ssbKeys.generate())
  
    alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
      if (err) throw err
      threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
        if (err) throw err
                      
        var flatThread = threadlib.flattenThread(thread)
        threadlib.reviseFlatThread(ssb, flatThread, 
          function(err, newFlatThread) {
            t.equal(newFlatThread.length, 1)
            t.equal(newFlatThread[0].key, msgA.key)
            t.end()
          })
        })
    })
  })

tape('reviseFlatThread returns the latest revision of every member of a thread', 
  function(t) {
    t.plan(4)
    
    var db = sublevel(level('test-patchwork-threads-revise-every-msg', {
      valueEncoding: defaults.codec
    }))
    var ssb = SSB(db, defaults)

    var alice = ssb.createFeed(ssbKeys.generate())
    var bob = ssb.createFeed(ssbKeys.generate())
    var carla = ssb.createFeed(ssbKeys.generate())
  
    // begin callback hellpyramid
    // load test thread into ssb
    alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
      if (err) throw err
       alice.add(schemas.postEdit('foo', msgA.key, null, msgA.key), 
         function(err, revisionA) {
      
          // first reply
          bob.add({ type: 'post', text: 'b', root: msgA.key }, function (err, msgB) {
            if (err) throw err

            // second reply
            carla.add({ type: 'post', text: 'c', root: msgA.key, branch: msgB.key }, 
              function (err, msgC) {
                if (err) throw err
          
                carla.add(schemas.postEdit('foo', msgC.key, null, msgC.key), 
                  function(err, revisionC) {

                    // fetch and flatten the complete unedited thread
                    threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
                      if (err) throw err
                      
                      var flatThread = threadlib.flattenThread(thread)
                      
                      // get each of the revisions manually
                      var revisionsCallback = multicb({pluck: 1})
                      threadlib.getLatestRevision(ssb, msgA, revisionsCallback())
                      threadlib.getLatestRevision(ssb, msgB, revisionsCallback())
                      threadlib.getLatestRevision(ssb, msgC, revisionsCallback())
              
                      threadlib.reviseFlatThread(ssb, flatThread, 
                        function(err, newFlatThread) {
                          revisionsCallback(function(err, latestRevs) {
                            t.equal(newFlatThread.length, 3)
                            t.equal(newFlatThread[0].key, latestRevs[0].key)
                            t.equal(newFlatThread[1].key, latestRevs[1].key)
                            t.equal(newFlatThread[2].key, latestRevs[2].key)
                            t.end()
                          })
                        })                                            
                      })
                  })
              })
          })
        })
    })
 })
