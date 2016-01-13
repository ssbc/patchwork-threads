var mlib = require('ssb-msgs')
var pull = require('pull-stream')
var multicb = require('multicb')

exports.fetchThreadRootID = function (ssb, mid, cb) {
  mid = (mid && typeof mid == 'object') ? mid.key : mid
  up()
  function up () {
    ssb.get(mid, function (err, msg) {
      if (err)
        return cb(err)

      // not found? finish here
      if (!msg)
        return finish()

      // decrypt as needed
      msg.plaintext = (typeof msg.content != 'string')
      if (msg.plaintext) return next()
      var decrypted = ssb.private.unbox(msg.content, next)
      if (decrypted) next(null, decrypted) // handle sync calling signature
      function next (err, decrypted) {
        if (decrypted)
          msg.content = decrypted

        // root link? go straight to that
        if (mlib.link(msg.content.root, 'msg')) {
          mid = mlib.link(msg.content.root).link
          return finish()
        }

        // branch link? ascend
        if (mlib.link(msg.content.branch, 'msg')) {
          mid = mlib.link(msg.content.branch).link
          return up()
        }

        // topmost, finish
        finish()
      }
    })
  }
  function finish () {
    cb(null, mid)
  }
}

exports.getPostThread = function (ssb, mid, opts, cb) {
  if (typeof opts == 'function') {
    cb = opts
    opts = null
  }

  // get message and full tree of backlinks
  ssb.relatedMessages({ id: mid, count: true }, function (err, thread) {
    console.log(thread)
    if (err) return cb(err)

    // get latest revision
    // exports.getLatestRevision(ssb, thread, function(thread) {
      exports.fetchThreadData(ssb, thread, opts, cb)
    // })
  })
}

exports.flattenThread = function (thread) {
  // build the thread into a flat, and correctly ordered, list
  // this means 
  // 1. putting all renderable messages (root, replies, and mentions) in a flat msgs list (so no recursion is required to render)
  // 2. ordering the list such that replies are always after their immediate parent
  // 3. weaving in mentions in a second pass (if a mention is also a reply, we want that to take priority)
  // 4. detecting missing parents and weaving in "hey this is missing" objects
  var related = (thread.related||[])
  var availableIds = new Set([thread.key].concat(related.map(function (m) { return m.key })))
  var addedIds = new Set([thread.key])
  var msgs = [thread]
  related.forEach(flattenAndReorderReplies)
  var msgsDup = msgs.slice() // duplicate so the weave iterations dont get disrupted by splices
  msgsDup.forEach(weaveMentions)
  msgsDup.forEach(weaveMissingParents)
  return msgs

  function insertReply (msg) {
    if (addedIds.has(msg.key))
      return // skip duplicates
    var branch = mlib.link(msg.value.content.branch) || mlib.link(msg.value.content.root)
    var branchIsRoot = (thread.key === branch.link)

    // dont insert if the parent post (branch) hasnt been inserted yet, but will be
    // (the message will be processed again as a .related of its parent)
    // this ensures children dont order before their parent
    // but, if the parent isnt in the available IDs, it's not in the local cache and we should go ahead and add
    if (!(branchIsRoot || addedIds.has(branch.link)) && availableIds.has(branch.link))
      return

    // iterate the existing messages...
    var hasFoundBranch = branchIsRoot
    for (var i=1; i < msgs.length; i++) { // start at 1 - root is always first
      // look for the parent (branch) first
      if (!hasFoundBranch) {
        if (msgs[i].key === branch.link)
          hasFoundBranch = true
        continue
      }

      // now insert in order of asserted timestamp
      if (msgs[i].value.timestamp > msg.value.timestamp) {
        msgs.splice(i, 0, msg)
        addedIds.add(msg.key)
        return
      }
    }
    msgs.push(msg)
    addedIds.add(msg.key)
  }
  function flattenAndReorderReplies (msg) {
    if (msg.value.content.type == 'post' && isaReplyTo(msg, thread)) {
      insertReply(msg)
      ;(msg.related||[]).forEach(flattenAndReorderReplies)
    }
  }

  function insertMention (msg, parentKey) {
    // find parent and insert after
    for (var i=0; i < msgs.length; i++) {
      if (msgs[i].key === parentKey) {
        msgs.splice(i+1, 0, { key: msg.key, isMention: true, value: msg.value })
        addedIds.add(msg.key)
        return
      }
    }
  }
  function weaveMentions (parent) {
    ;(parent.related||[]).forEach(function (msg) { 
      if (addedIds.has(msg.key))
        return // skip duplicates
      // insert if a mention to its parent
      if (msg.value.content.type == 'post' && isaMentionTo(msg, parent))
        insertMention(msg, parent.key)
    })
  }

  function insertMissingParent (parentKey, childKey) {
    // find child and insert before
    for (var i=0; i < msgs.length; i++) {
      if (msgs[i].key === childKey) {
        msgs.splice(i, 0, { key: parentKey, isNotFound: true })
        addedIds.add(parentKey)
        return
      }
    }
  }
  function weaveMissingParents (msg, i) {
    if (msg.isMention)
      return // ignore the mentions

    var branch = mlib.link(msg.value.content.branch, 'msg')
    if (branch && !addedIds.has(branch.link)) {
      if (i === 0) {
        // topmost post
        // user may be looking at a reply - just display a link
        msgs.unshift({ key: branch.link, isLink: true })
      } else {
        // one of the replies
        // if the parent isnt somewhere in the thread, then we dont have it
        insertMissingParent(branch.link, msg.key)
      }
    }
  }
}

exports.getParentPostThread = function (ssb, mid, opts, cb) {
  exports.fetchThreadRootID(ssb, mid, function (err, mid) {
    if (err) return cb(err)
    exports.getPostThread(ssb, mid, opts, cb)
  })
}

exports.getPostSummary = function (ssb, mid, opts, cb) {
  if (typeof opts == 'function') {
    cb = opts
    opts = null
  }

  // get message and immediate backlinks
  var done = multicb({ pluck: 1, spread: true })
  var msgCb = done()
  ssb.get(mid, function (err, msg) {
    // suppress error caused by not found, will be reflected by missing `value`
    msgCb(null, msg)
  })
  pull(ssb.links({ dest: mid, keys: true, values: true }), pull.collect(done()))
  done(function (err, value, related) {
    if (err) return cb(err)
    var thread = { key: mid, value: value, related: related }
    exports.fetchThreadData(ssb, thread, opts, cb)
  })
}

exports.getParentPostSummary = function (ssb, mid, opts, cb) {
  exports.fetchThreadRootID(ssb, mid, function (err, mid) {
    if (err) return cb(err)
    exports.getPostSummary(ssb, mid, opts, cb)
  })
}

exports.fetchThreadData = function (ssb, thread, opts, cb) {
  // decrypt as needed
  exports.decryptThread(ssb, thread, function (err) {
    if (err) return cb(err)
    var done = multicb()

    // fetch isread state for posts (only 1 level deep, dont need to recurse)
    if (!opts || opts.isRead)
      exports.attachThreadIsread(ssb, thread, 1, done())

    // fetch bookmark state
    if (!opts || opts.isBookmarked)
      exports.attachThreadIsbookmarked(ssb, thread, 1, done())

    // look for user mentions
    if (!opts || opts.mentions) {
      thread.mentionsUser = false
      exports.iterateThreadAsync(thread, 1, function (msg, cb2) {
        var c = msg.value.content
        if (c.type !== 'post' || !c.mentions) return cb2()
        mlib.links(c.mentions, 'feed').forEach(function (l) {
          if (false)//l.link === app.user.id)
            thread.mentionsUser = true
        })
        cb2()
      }, done())
    }

    // compile votes
    if (!opts || opts.votes)
      exports.compileThreadVotes(thread)
    done(function (err) {
      if (err) return cb(err)
      cb(null, thread)
    })
  })
}

exports.iterateThread = function (thread, maxDepth, fn) {
  thread.value && fn(thread)
  if (thread.related)
    iterate(thread.related, 1)

  function iterate (msgs, n) {
    if (!isNaN(maxDepth) && n > maxDepth)
      return
    // run through related
    msgs.forEach(function (msg) {
      msg.value && fn(msg) // run on item
      if (msg.related)
        iterate(msg.related, n+1)
    })
  }
}

exports.iterateThreadAsync = function (thread, maxDepth, fn, cb) {
  var done = multicb()
  thread.value && fn(thread, done()) // run on toplevel
  if (thread.related)
    iterate(thread.related, 1)
  done(function (err) { cb(err, thread) })

  function iterate (msgs, n) {
    if (!isNaN(maxDepth) && n > maxDepth)
      return
    // run through related
    msgs.forEach(function (msg) {
      msg.value && fn(msg, done()) // run on item
      if (msg.related)
        iterate(msg.related, n+1)
    })
  }
}

exports.attachThreadIsread = function (ssb, thread, maxdepth, cb) {
  thread.hasUnread = false
  exports.iterateThreadAsync(thread, maxdepth, function (msg, cb2) {
    if ('isRead' in msg)
      return cb2() // already handled
    if (msg.value.content.type != 'post')
      return cb2() // not a post
    if (msg !== thread && !isaReplyTo(msg, thread))
      return cb2() // not a reply

    msg.isRead = false
    ssb.patchwork.isRead(msg.key, function (err, isRead) {
      msg.isRead = isRead
      thread.hasUnread = thread.hasUnread || !isRead
      cb2()
    })
  }, cb)
}

exports.attachThreadIsbookmarked = function (ssb, thread, maxdepth, cb) {
  exports.iterateThreadAsync(thread, maxdepth, function (msg, cb2) {
    if ('isBookmarked' in msg)
      return cb2() // already handled
    if (msg.value.content.type != 'post')
      return cb2() // not a post
    if (msg !== thread && !isaReplyTo(msg, thread))
      return cb2() // not a reply

    msg.isBookmarked = false
    ssb.patchwork.isBookmarked(msg.key, function (err, isBookmarked) {
      msg.isBookmarked = isBookmarked
      cb2()
    })
  }, cb)
}

exports.compileThreadVotes = function (thread) {
  compileMsgVotes(thread)
  function compileMsgVotes (msg) {
    msg.votes = {}
    if (!msg.related || !msg.related.length)
      return

    msg.related.forEach(function (r) {
      var c = r.value.content
      if (c.type === 'vote' && c.vote && 'value' in c.vote)
        msg.votes[r.value.author] = c.vote.value // record vote
      if (c.type === 'post' && isaReplyTo(r, msg))
        compileMsgVotes(r) // recurse
    })
  }
}

exports.markThreadRead = function (ssb, thread, cb) {
  // is any message in the thread unread?
  if (!thread.hasUnread)
    return cb() // no need
  // iterate only 1 level deep, dont need to recurse
  exports.iterateThreadAsync(thread, 1, function (msg, cb2) {
    if (msg == thread) {
      // always mark the root read, to update the API's isread index
    } else {
      if (msg.isRead)
        return cb2() // already marked read
      if (msg.value.content.type != 'post')
        return cb2() // not a post
      if (!isaReplyTo(msg, thread))
        return cb2() // not a reply
    }

    ssb.patchwork.markRead(msg.key, function (err, isRead) {
      msg.isRead = true
      cb2()
    })
  }, function () {
    thread.hasUnread = false
    cb()
  })
}

exports.decryptThread = function (ssb, thread, cb) {
  exports.iterateThreadAsync(thread, undefined, function (msg, cb2) {
    if ('plaintext' in msg)
      return cb2() // already handled

    msg.plaintext = (typeof msg.value.content != 'string')
    if (msg.plaintext)
      return cb2() // not encrypted

    // decrypt
    var decrypted = ssb.private.unbox(msg.value.content, next)
    if (decrypted) next(null, decrypted) // handle sync calling-signature
    function next (err, decrypted) {
      if (decrypted)
        msg.value.content = decrypted
      cb2()
    }
  }, cb)
}

exports.getLastThreadPost = function (thread) {
  var msg = thread
  if (!thread.related)
    return msg
  thread.related.forEach(function (r) {
    var c = r.value.content
    var root = mlib.link(c.root)
    if (c.type === 'post' && root && root.link == thread.key && r.value.timestamp > msg.value.timestamp)
      msg = r
  })
  return msg
}

/* post revision utils */

exports.getRevisions = function(ssb, thread, callback) {
  function collectRevisions(thread) {
    // this function walks the revisions of a given thread, collecting them up
    // asyncly

    var threadRevisions = thread.related
        .map(function(relatedMsg) {
      
        if (relatedMsg.value.content.type === 'post-edit' &&
            // ^ make sure it's an edit
            relatedMsg.value.content.revision &&
            // ^ may be unnecessary if schema validates
            (relatedMsg.value.content.revision === thread.key ||
             relatedMsg.value.content.root     === thread.key)
            // ^ either the msg revises the root, or it's a subsequent revision
           ) {
          return(relatedMsg);
        }
      })
      .filter(function(msg) { return msg || false}) // eliminate falsehood
      .sort(function (oneRev, otherRev) { // remove duplicates by sorting and
                                          // reducing over the sorted arr
        return oneRev.key < otherRev.key
      });
    if (threadRevisions.length > 0) {
      threadRevisions =
        threadRevisions.reduce(function(prevRevs, thisRev, thisInd) {
          var previousKey = "";
          prevRevs.length ?
            previousKey = prevRevs[prevRevs.length - 1].key :
            previousKey = prevRevs.key
          if (previousKey === thisRev.key) {
            // remove duplicate
            return (prevRevs instanceof Array ? prevRevs : [prevRevs])
          } else {
            if (!prevRevs.concat) { // js, your reduce is strange
              return [].concat(prevRevs, thisRev)
            } else {
              return prevRevs.concat(thisRev)
            }
          }
        })
    }
    return threadRevisions
  }
            

  if (!thread.hasOwnProperty('related')) { // if the thread doesn't have its related objects,
                         // fetch them
    ssb.relatedMessages(thread, function(err, enrichedThread) {
      if (err) throw err
      else if (!enrichedThread.hasOwnProperty('related')) callback([]) // if still no related objects
      else callback(collectRevisions(enrichedThread))
    })
  } else { // note: this branch is technically synchronous and the above is not
           // :(
    callback(collectRevisions(thread))
  }  
}

exports.getLatestRevision = function(ssb, msg, callback) {
  // get the revisions, and then callback on which one is latest
  exports.getRevisions(ssb, msg, function(msgRevisions) {
    var sortedRevisions = msgRevisions.sort(function(msg, otherMsg) {
      // sort descending in time
      return msg.value.timestamp < otherMsg
    })
    if (sortedRevisions === undefined) // no revisions case
      callback(msg)
    else callback(sortedRevisions[0])
  })
}

function isaReplyTo (a, b) {
  var rels = mlib.relationsTo(a, b)
  return rels.indexOf('root') >= 0 || rels.indexOf('branch') >= 0
}

function isaMentionTo (a, b) {
  return mlib.relationsTo(a, b).indexOf('mentions') >= 0
}
