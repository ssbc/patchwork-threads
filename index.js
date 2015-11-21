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
    if (err) return cb(err)
    exports.fetchThreadData(ssb, thread, opts, cb)
  })
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
  ssb.get(mid, done())
  pull(ssb.links({ dest: mid, keys: true, values: true }), pull.collect(done()))
  done((err, value, related) => {
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
  fn(thread)
  if (thread.related)
    iterate(thread.related, 1)

  function iterate (msgs, n) {
    if (!isNaN(maxDepth) && n > maxDepth)
      return
    // run through related
    msgs.forEach(function (msg) {
      fn(msg) // run on item
      if (msg.related)
        iterate(msg.related, n+1)
    })
  }
}

exports.iterateThreadAsync = function (thread, maxDepth, fn, cb) {
  var done = multicb()
  fn(thread, done()) // run on toplevel
  if (thread.related)
    iterate(thread.related, 1)
  done(function (err) { cb(err, thread) })

  function iterate (msgs, n) {
    if (!isNaN(maxDepth) && n > maxDepth)
      return
    // run through related
    msgs.forEach(function (msg) {
      fn(msg, done()) // run on item
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

    msg.isBookmarked = false
    ssb.patchwork.isBookmarked(msg.key, function (err, isBookmarked) {
      msg.isBookmarked = isBookmarked
      cb2()
    })
  }, cb)
}

exports.compileThreadVotes = function (thread) {
  compileMsgVotes(thread)
  if (thread.related)
    thread.related.forEach(compileMsgVotes)

  function compileMsgVotes (msg) {
    msg.votes = {}
    if (!msg.related || !msg.related.length)
      return

    msg.related.forEach(function (r) {
      var c = r.value.content
      if (c.type === 'vote' && c.vote && 'value' in c.vote)
        msg.votes[r.value.author] = c.vote.value
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
      // is this message already read?
      if (msg.isRead)
        return cb2() // skip
    }
    if (msg.value.content.type != 'post')
      return cb2() // not a post

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