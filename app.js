GLOBAL.DEBUG = true

require.paths.unshift(__dirname + "/vendor/Socket.IO-node/lib")
require.paths.unshift(__dirname + "/vendor/nodetk/src")
require.paths.unshift(__dirname + "/vendor/node-formidable/lib/")


var GEEKS_AVATARS = __dirname + "/public/images/geeks/"


var sys = require("sys"),
    fs = require('fs'),
    kiwi = require("kiwi"),
    io = require('socket.io'),
    utils = require("nodetk/utils"),
    debug = require("nodetk/logging").debug,
    RFactory = require("./db").RFactory,
    config = require('./config')

debug.on()

require.paths.unshift(__dirname + "/lib")

// Express
kiwi.require("express")
require("express/plugins")

configure(function() {
  kiwi.seed("haml")
  use(Logger)
  use(MethodOverride)
  use(ContentLength)
  use(Cookie)
  set('root', __dirname)
  use(Static)
  set("cache static files")
})


// Sample component
var _Bars  = require("Bars"),
    Bars   = _Bars.Bars,
    Bar    = _Bars.Bar
new Bar('localhost', 3001)

/**
 * Home page
 */
get('/', function() {
  var self = this,
      R = RFactory()
  self.contentType("html")

  R.Geek.index(function(result) {
      self.render("index.html.haml", {locals: {geeks: result}})
  }, function(err) {
      self.respond(400, "Database error")
  })
})


get('/geeks.json', function() {
  var self = this,
      R = RFactory()
  self.contentType("json")
 
  R.Geek.index(function(geeks) {
    geeks = geeks.map(function(geek) {return geek.json()})
    self.respond(200, JSON.stringify(geeks))
  }, function(error) {
    self.respond(501)
  })
})


get('/geeks/:id/edit', function(id) {
  var self = this,
      R = RFactory()

  R.Geek.get({ids: id}, function(geek) {
    if(!geek) return self.respond(404);
    self.render("edit_geek.html.haml", {locals: {geek: geek}, layout: false})
  }, function(error) {
    self.respond(501)
  });
})


get('/urls.json', function() {
  var self = this,
      R = RFactory()
  self.contentType("json")

  R.URL.index(function(urls) {
    urls = urls.map(function(url) {return url.json()});
    self.respond(200, JSON.stringify(urls))
  }, function(error) {
    self.respond(501)
  })
})

/**
 * Update existing Geek
 * Needs JSON stuff in body request!
 */
post('/geeks/:id', function(id) {
  var R = RFactory(),
      self = this,
      geek

  try {
    geek = JSON.parse(self.body)
    // TODO: cleaner filtering
    delete geek.id
    delete geek.movable
    delete geek.resizable
  } catch (e) {
    sys.puts(e)
    return self.respond(400)
  }

  R.Geek.update({
    ids: id,
    data: geek
  }, function() { // reask for complete geek, as the updating data might be partial
    R.Geek.get({ids: id}, function(geek) {
      if(!geek) self.respond(404)
      websocket_listener.broadcast({event: "UpdateGeek", data: geek})
      self.respond(200)
    }, function(error) {
      self.respond(501)
    })
  }, function() {
    self.respond(501)
  });
});

/** Upload avatar for geek
 */
post('/geeks/:id/avatar', function(id) {
  var self = this
      avatar = this.param('avatar')
      R = RFactory()

  if(!avatar.filename || !avatar.tempfile) self.respond(400)
  R.Geek.get({ids: id}, function(geek) {
    var previous = geek.avatar_fname && parseInt(geek.avatar_fname.split('_')[1]) || 0
    geek.avatar_fname = id + "_" + (previous + 1)

    fs.rename(avatar.tempfile, GEEKS_AVATARS + geek.avatar_fname, function(error) {
      if(error) return self.respond(502)
      self.respond(200)//, JSON.stringify(geek.avatar_fname))
      geek.save(function() {
        setTimeout(function() {
          // We wait a bit here to be sure express understant the fact that there
          // is a new picture...
          // XXX: fixme it defeats the use of "live" events ...
          websocket_listener.broadcast({event: "UpdateGeek", data: geek})
        }, 200);
      })
    })
  }, function(err) {
    self.respond(404)
  })
})


/**
 * Create a new event
 */
post('/events', function() {
  event = JSON.parse(this.body)
  sys.puts('event: ' + JSON.stringify(event))
  websocket_listener.broadcast(event)
  this.respond(200)
})

/**
 * Create a new geek.
 */
post("/geeks", function() {
    var self = this,
        R = RFactory()

    var geek = new R.Geek({name: this.param("name"),
                           nickname: this.param("nickname"),
                           pole: this.param("pole")
    })
    geek.save(function() {
        websocket_listener.broadcast({event: "NewGeek", data: geek})
        self.respond(201)
    }, function(err) {
        self.respond(400, "failed")
    })
})

/**
 * Display a form to create a new geek
 */
get("/geeks/new", function(){
  this.render("new_geek.html.haml", { layout: false })
})

/* Serve JS client files from git submodules in /vendor/js_client/ dir.
 */
var jslibs = {
  'jquery.drag_resize': 'jquery.drag_resize/jquery.drag_resize.js',
  'jquery.mousewheel': 'jquery.mousewheel/jquery.mousewheel.js',
  'jquery.px2percent': 'jquery.px2percent/jquery.px2percent.js',
  'sammy': 'sammy/lib/sammy.js',
  'ajax-upload': 'ajax-upload/ajaxupload.js',
}
get('/public/js2/:name.js', function(name) {
  var path = jslibs[name]
  if(name) {
    this.sendfile(__dirname + '/vendor/js_client/' + path)
  }
})


/**
 * Want to clean Geeks list ?
 */
post('/geeks/purge', function() {
    var self = this,
        R = RFactory()
    R.Geek.clear_all(function() {
        self.respond(200, "Geeks deleted")
    }, function(err) {
        self.respond(400)
    })
})


post('/upload', function() {
  sys.debug('/upload on express side')
  return
})


var server = run(config.server.port, config.server.host)
var websocket_listener = io.listen(server, {
    resource: "socket.io", 
    transports: ['websocket'],
})

