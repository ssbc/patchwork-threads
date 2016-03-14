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

tape('createRevisionLog returns an array of revisions back to root', function(t) {
  t.plan(5)
    
  var db = sublevel(level('test-patchwork-threads-revision-log', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssb.createFeed(ssbKeys.generate())
  
  // load test thread into ssb
  alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
    if (err) throw err

    alice.add({type: 'post-edit', text: 'a-revised', 
      root: msgA.key, revision: msgA.key}, function(err, revisionA) {
        if (err) throw err

        alice.add({type: 'post-edit', text: 'a-revised2', 
          root: msgA.key, revision: revisionA.key}, function(err, revisionA2) {
            if (err) throw err

            threadlib.createRevisionLog(ssb, revisionA2, function(err, threadLog) {
              t.ok(threadLog instanceof Array)
              t.equal(threadLog.length, 3)
              t.equal(threadLog[0].value.content.text, 'a-revised2')
              t.equal(threadLog[1].value.content.text, 'a-revised')
              t.equal(threadLog[2].value.content.text, 'a')
            })
        })
      })
  })
})


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
     t.plan(3)
       
       var db = sublevel(level('test-patchwork-threads-revision-array-count', {
         valueEncoding: defaults.codec
       }))
       var ssb = SSB(db, defaults)
       var alice = ssb.createFeed(ssbKeys.generate())
       
       alice.add({ type: 'post', text: 'a' }, function (err, origMsg) {
         if (err) throw err
         
         // add revision  
         alice.add(schemas.postEdit('foo', origMsg.key, null, origMsg.key), 
                   function(err, revisionA) {
                     if (err) throw err
                     var msg = origMsg;
                     
                     threadlib.getRevisions(ssb, msg, function(err, revisions) {
                       if (err) throw err
                       
                       t.equal(revisions.length, 2)
                       t.equal(revisions[revisions.length-1].value.content.type, 'post')
                       t.ok(revisions.slice(0,1).every(function(rev){
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
  
  alice.add({ type: 'post', text: 'a-initial' }, function (err, origMsg) {
    if (err) throw err
    
    // add revision  
    alice.add(schemas.postEdit('a-latest', origMsg.key, null, origMsg.key), function(err, revisionA) {
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
      t.equal(latestRev.key, origMsg.key)
      t.end()
    })
  })
})

tape('getLatestRevision returns latest rev of a msg even if edited many times', 
  function(t) {
    t.plan(2)
  
    var db = sublevel(level('test-patchwork-threads-latest-multi-rev', {
      valueEncoding: defaults.codec
    }))
    var ssb = SSB(db, defaults)
    var alice = ssb.createFeed(ssbKeys.generate())
    
    alice.add({ type: 'post', text: 'a-init-multi' }, function (err, origMsg) {
      if (err) throw err
      
      // add revision  
      alice.add(schemas.postEdit('a-revised', origMsg.key, null, origMsg.key), function(err, revisionA) {
        if (err) throw err

        // add another revision
        alice.add(schemas.postEdit('a-revised2', origMsg.key, null, revisionA.key), function(err, revisionA2) {
          if (err) throw err

          threadlib.getLatestRevision(ssb, origMsg, function(err, latestRev) {
            t.equal(latestRev.value.content.type, 'post-edit')
            t.equal(latestRev.value.content.text, 'a-revised2')
            t.end()
          })
        })
      })
    })  
  })

tape('getLatestRevision is not confused by multiple edits different from root',
  function(t) {
    t.plan(4)
  
    var db = sublevel(level('test-patchwork-threads-latest-multi-rev-root', {
      valueEncoding: defaults.codec
    }))
    var ssb = SSB(db, defaults)
    var alice = ssb.createFeed(ssbKeys.generate())
    var bob = ssb.createFeed(ssbKeys.generate())
    
    alice.add({ type: 'post', text: 'a' }, function (err, msgA) {
      if (err) throw err
      
      // add reply
      bob.add({type: 'post', text: 'edge3-b'}, function(err, msgB) {
        if (err) throw err

        // add revision
        bob.add(schemas.postEdit('edge3-b-revised2', msgA.key, null, msgB.key), function(err, revisionB2) {
          if (err) throw err

          // add another revision
          bob.add(schemas.postEdit('edge3-b-revised3', msgA.key, null, revisionB2.key), function(err, revisionB3) {
            if (err) throw err

            threadlib.getLatestRevision(ssb, msgB, function(err, latestRev) {
              if (err) throw err

              t.equal(latestRev.value.content.type, 'post-edit')
              t.equal(latestRev.value.content.text, 'edge3-b-revised3')

              // the root post should not show revisions
              threadlib.getLatestRevision(ssb, msgA, function(err, latestRev2) {
                if (err) throw err
                
                t.equal(latestRev2.value.content.type, 'post')
                t.equal(latestRev2.value.content.text, 'a')
                t.end()
              })
            })
          })
        })
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
    t.plan(9)
    
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
      // first reply
      bob.add({ type: 'post', text: 'b', root: msgA.key }, function (err, msgB) {
        if (err) throw err

        // second reply
        carla.add({ type: 'post', text: 'c', root: msgA.key, branch: msgB.key }, 
          function (err, msgC) {
            if (err) throw err
          
            carla.add({type: 'post-edit', text: 'c-revised', 
                       root: msgA.key, revision: msgC.key},
                       function(err, revisionC) {

                         // fourth reply
                         bob.add({type: 'post', text: 'b2', root: msgA.key}, 
                         function(err, msgB2) {
                           // bob revises first reply
                           bob.add({ type: 'post-edit', text: 'b-revised', 
                                     root: msgA.key, revision: msgB.key }, 
                             function (err, revisionB) {
                               if (err) throw err
                        
                               // fetch and flatten the complete unedited thread
                               threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
                                 if (err) throw err
                      
                                 var flatThread = threadlib.flattenThread(thread)
                      
                                 // get each of the revisions manually
                                 var revisionsCallback = multicb({pluck: 1})
                                 threadlib.getLatestRevision(ssb, msgA, revisionsCallback())
                                 threadlib.getLatestRevision(ssb, msgB, revisionsCallback())
                                 threadlib.getLatestRevision(ssb, msgC, revisionsCallback())
                                 threadlib.getLatestRevision(ssb, msgB2, revisionsCallback())

                                 threadlib.reviseFlatThread(ssb, flatThread, 
                                   function(err, newFlatThread) {
                                     if (err) throw err

                                     revisionsCallback(function(err, latestRevs) {
                                       if (err) throw err
                                       t.equal(newFlatThread.length, 4)
                                       t.equal(newFlatThread[0].key, latestRevs[0].key)
                                       t.equal(newFlatThread[1].key, latestRevs[1].key)
                                       t.equal(newFlatThread[2].key, latestRevs[2].key)
                                       t.equal(newFlatThread[3].key, latestRevs[3].key)
                                       t.equal(newFlatThread[0].value.content.text, 'a')
                                       t.equal(newFlatThread[1].value.content.text, 'b-revised')
                                       t.equal(newFlatThread[2].value.content.text, 'c-revised')
                                       t.equal(newFlatThread[3].value.content.text, 'b2')
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
  })

tape('reviseFlatThread returns properly even if root is revised', 
  function(t) {
    t.plan(7)
    
    var db = sublevel(level('test-patchwork-threads-revise-root', {
      valueEncoding: defaults.codec
    }))
    var ssb = SSB(db, defaults)

    var alice = ssb.createFeed(ssbKeys.generate())
    var bob = ssb.createFeed(ssbKeys.generate())
    var carla = ssb.createFeed(ssbKeys.generate())
  
    // begin callback hellpyramid
    // load test thread into ssb
    alice.add({ type: 'post', text: 'a' },
              function (err, msgA) {
                if (err) throw err
                alice.add({type: 'post-edit', text: 'a-revised', 
                           root: msgA.key, revision: msgA.key},
                          function(err, revisionA) {
                            
                            // first reply
                            bob.add({ type: 'post', text: 'b', root: msgA.key }, function (err, msgB) {
                                                                                if (err) throw err
                              
                              // second reply
                              carla.add({ type: 'post', text: 'c', root: msgA.key, branch: msgB.key }, 
                                        function (err, msgC) {
                                          if (err) throw err
                                          
                                          carla.add({type: 'post-edit', text: 'c-revised', 
                                                     root: msgA.key, revision: msgC.key},
                                                    function(err, revisionC) {
                                                      if (err) throw err
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
                                                                                       t.equal(newFlatThread[0].value.content.text, 'a-revised')
                                                                                       t.equal(newFlatThread[1].value.content.text, 'b')
                                                                                       t.equal(newFlatThread[2].value.content.text, 'c-revised')
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

tape('edge 1: root edited multiple times out of sequence with rest of thread',
  function(t) {
    t.plan(4)
    
    var db = sublevel(level('test-patchwork-threads-revise-root-multi-edit', {
      valueEncoding: defaults.codec
    }))
    var ssb = SSB(db, defaults)

    var alice = ssb.createFeed(ssbKeys.generate())
    var bob = ssb.createFeed(ssbKeys.generate())
    var carla = ssb.createFeed(ssbKeys.generate())
    
    // begin callback hellpyramid
    // load test thread into ssb
    alice.add({ type: 'post', text: 'edge-a' },
              function (err, msgA) {
                if (err) throw err
                
                alice.add({type: 'post-edit', text: 'edge-a-revised', 
                           root: msgA.key, revision: msgA.key},
                          function(err, revisionA) {
                            
                            // first reply
                            bob.add({ type: 'post', text: 'edge-b', root: msgA.key },
                                    function (err, msgB) {
                                      if (err) throw err
                                      
                                      // second reply
                                      carla.add({ type: 'post', text: 'edge-c', root: msgA.key, branch: msgB.key }, 
                                                function (err, msgC) {
                                                  if (err) throw err
                                                  
                                                  carla.add({type: 'post-edit', text: 'edge-c-revised',
                                                             root: msgA.key, revision: msgC.key},
                                                            function(err, revisionC) {
                                                              if (err) throw err
                                                              alice.add({type: 'post-edit', text: 'edge-a-revised2', 
                                                                         root: msgA.key, revision: revisionA.key},
                                                                        function(err, revisionA2) {
                                                                          if (err) throw err

                                                                          // fetch and flatten the complete unedited thread
                                                                          threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
                                                                            if (err) throw err
                                                                            
                                                                            var flatThread = threadlib.flattenThread(thread)
                                                                            
                                                                            // get each of the revisions manually
                                                                            var revisionsCallback = multicb({pluck: 1})
                                                                            
                                                                            threadlib.reviseFlatThread(ssb, flatThread, 
                                                                                                       function(err, newFlatThread) {
                                                                                                         threadlib.getLatestRevision(ssb, msgA, revisionsCallback())
                                                                                                         threadlib.getLatestRevision(ssb, msgB, revisionsCallback())
                                                                                                         threadlib.getLatestRevision(ssb, msgC, revisionsCallback())
                                                                                                         
                                                                                                         revisionsCallback(function(err, latestRevs) {
                                                                                                           t.equal(newFlatThread.length, 3)
                                                                                                           t.equal(newFlatThread[0].value.content.text, 'edge-a-revised2')
                                                                                                           t.equal(newFlatThread[1].value.content.text, 'edge-b')
                                                                                                           t.equal(newFlatThread[2].value.content.text, 'edge-c-revised')
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
  })

tape('edge 2: reply edited out of sequence with rest of thread', function(t) {
  t.plan(4)
  
  var db = sublevel(level('test-patchwork-threads-reply-revise-multi-edit', {
    valueEncoding: defaults.codec
  }))
  var ssb = SSB(db, defaults)

  var alice = ssb.createFeed(ssbKeys.generate())
  var bob = ssb.createFeed(ssbKeys.generate())
  var carla = ssb.createFeed(ssbKeys.generate())
  
  // begin callback hellpyramid
  // load test thread into ssb
  alice.add({ type: 'post', text: 'edge2-a' },
            function (err, msgA) {
              if (err) throw err

              // first reply
              bob.add({ type: 'post', text: 'edge2-b', root: msgA.key },
                      function (err, msgB) {
                        if (err) throw err
                        
                        // second reply
                        carla.add({ type: 'post', text: 'edge2-c', root: msgA.key, branch: msgB.key }, 
                                  function (err, msgC) {
                                    if (err) throw err
                                    
                                    bob.add({type: 'post-edit', text: 'edge2-b-revised',
                                             root: msgA.key, revision: msgB.key},
                                            function(err, revisionB) {
                                              if (err) throw err
                                              bob.add({type: 'post-edit', text: 'edge2-b-revised2', 
                                                       root: msgA.key, revision: revisionB.key},
                                                      function(err, revisionA2) {
                                                        if (err) throw err

                                                        // fetch and flatten the complete unedited thread
                                                        threadlib.getPostThread(ssb, msgA.key, {}, function (err, thread) {
                                                          if (err) throw err
                                                          
                                                          var flatThread = threadlib.flattenThread(thread)
                                                                                      
                                                                                  // get each of the revisions manually
                                                                                  var revisionsCallback = multicb({pluck: 1})
                                                                                  debugger
                                                                                  threadlib.reviseFlatThread(ssb, flatThread, 
                                                                                                             function(err, newFlatThread) {
                                                                                                               threadlib.getLatestRevision(ssb, msgA, revisionsCallback())
                                                                                                               threadlib.getLatestRevision(ssb, msgB, revisionsCallback())
                                                                                                               threadlib.getLatestRevision(ssb, msgC, revisionsCallback())
                                                                                                               
                                                                                                               revisionsCallback(function(err, latestRevs) {
                                                                                            t.equal(newFlatThread.length, 3)
                                                                                            t.equal(newFlatThread[0].value.content.text, 'edge2-a')
                                                                                            t.equal(newFlatThread[1].value.content.text, 'edge2-b-revised2')
                                                                                            t.equal(newFlatThread[2].value.content.text, 'edge2-c')
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


