var _ = require('underscore')
  , async = require('async')
  , assert = require('assert')
  , osc = require('node-osc')
  , wsServer = require('../lib/server/websockets')
  , oscServer = require('../lib/server/osc')
  , client = require('../lib/client/client')

var config = {
    server: { port: 8000, rootUrl: '/', usersLimit: 40 },
    osc: { port: 9000, hostname: 'localhost', clients: [] }
  }
  , oscClient = new osc.Client(config.server.hostname, config.osc.port)

// For testing : we need to add standard `removeEventListener` method cause `ws` doesn't implement it.
var WebSocket = require('ws')
WebSocket.prototype.removeEventListener = function(name, cb) {
  var self = this
    , handlerList = this._events[name]
  handlerList = _.isFunction(handlerList) ? [handlerList] : handlerList
  this._events[name] = _.reject(handlerList, function(other) {
    return other._listener === cb
  })
}

// Helper to create dummy connections from other clients
var dummyConnections = function(count, done) {
  var countBefore = wsServer.sockets().length
  async.series(_.range(count).map(function(i) {
    return function(next) {
      socket = new WebSocket('ws://localhost:' + config.server.port + '/?dummies')
      _dummies.push(socket)
      socket.addEventListener('open', function() { next() })
    }
  }), function(err) {
    assert.equal(wsServer.sockets().length, countBefore + count)
    done(err)
  })
}
_dummies = []

describe('client <-> server', function() {

  before(function(done) { oscServer.start(config, done) })
  beforeEach(function(done) {
    //client.debug = console.log
    done()
  })
  afterEach(function(done) {
    _dummies.forEach(function() { socket.close() })
    _dummies = []
    client.debug = function() {}
    async.series([ client.stop, wsServer.stop ], done)
  })

  describe('start', function() {
    
    beforeEach(function(done) {
      config.server.usersLimit = 1
      client.config.reconnect = 0
      wsServer.start(config, done)
    })
    afterEach(function() { config.server.usersLimit = 10 })

    it('should open a socket connection to the server', function(done) {
      assert.equal(client.status(), 'stopped')
      assert.equal(client.userId, null)
      assert.equal(wsServer.sockets().length, 0)
      client.start(function(err) {
        if (err) throw err
        assert.equal(client.status(), 'started')
        assert.equal(wsServer.sockets().length, 1)
        assert.equal(client.userId, 0)
        done()
      })
    })

    it('should reject connection if server is full', function(done) {
      assert.equal(client.status(), 'stopped')
      assert.equal(wsServer.sockets().length, 0)
      assert.equal(client.userId, null)
      async.series([
        function(next) { dummyConnections(1, next) },
        function(next) { client.start(next) },
        function(next) { setTimeout(next, 500) }
      ], function(err) {
        assert.ok(err)
        assert.equal(client.status(), 'started')
        assert.equal(_.last(wsServer.sockets()).readyState, WebSocket.CLOSING)
        assert.equal(client.userId, null)
        done()
      })
    })

  })

  describe('listen', function() {
    
    beforeEach(function(done) {
      client.config.reconnect = 0
      async.series([
        function(next) { wsServer.start(config, next) },
        function(next) { client.start(done) }
      ])
    })

    it('should receive messages from the specified address', function(done) {
      assert.equal(wsServer.nsTree.has('/place1'), false)
      
      var listend = function(err) {
        if (err) throw err
        assert.equal(wsServer.nsTree.has('/place1'), true)
        assert.equal(wsServer.nsTree.get('/place1').data.sockets.length, 1)
        oscClient.send('/place2', 44)
        oscClient.send('/place1', 1, 2, 3)
      }

      var handler = function(address, args) {
        assert.equal(address, '/place1')
        assert.deepEqual(args, [1, 2, 3])
        done()
      }

      client.listen('/place1', handler, listend)
    })

    it('shouldn\'t cause problem if listening twice same place', function(done) {
      var answered = 0

      var handler = function() {}          

      var listend = function(err) {
        if (err) throw err
        answered++
        assert.equal(wsServer.nsTree.get('/place1').data.sockets.length, 1)
        if (answered === 2) done()
      }

      client.listen('/place1', handler, listend)
      client.listen('/place1', handler, listend)
    })

    it('should receive all messages from subspaces', function(done) {
      var received = []
      var listend = function(err) {
        if (err) throw err
        oscClient.send('/a', 44)
        oscClient.send('/a/b', 55)
        oscClient.send('/', 66)
        oscClient.send('/c', 77)
        oscClient.send('/a/d', 88)
        oscClient.send('/a/', 99)
      }

      var handler = function(address, args) {
        received.push([args[0], address])
        assert.equal(args.length, 1)
        if (received.length === 4) {
          var sortFunc = function(p) { return p[0] }
          assert.deepEqual(
            _.sortBy(received, sortFunc),
            _.sortBy([[44, '/a'], [55, '/a/b'], [88, '/a/d'], [99, '/a']], sortFunc)
          )
          done()
        }
      }

      client.listen('/a', handler, listend)
    })

  })

  describe('message', function() {
    
    beforeEach(function(done) {
      config.osc.clients = [
        { ip: 'localhost', port: 9005 },
        { ip: 'localhost', port: 9010 }
      ]
      wsServer.start(config, done)
    })
    beforeEach(function(done) {
      client.config.reconnect = 0
      client.start(done)
    })

    it('should receive messages from the specified address', function(done) {
      var oscTrace1 = new osc.Server(9005, 'localhost')
        , oscTrace2 = new osc.Server(9010, 'localhost')
        , received = []

      var assertions = function() {
        received = _.sortBy(received, function(r) { return '' + r[0] + r[1][0] })
        assert.deepEqual(received, [
          [1, ['/bla', 1, 2, 3]],
          [1, ['/blo', 'oui', 'non']],
          [2, ['/bla', 1, 2, 3]],
          [2, ['/blo', 'oui', 'non']]
        ])
        done()
      }

      oscTrace1.on('message', function (msg, rinfo) {
        received.push([1, msg])
        if (received.length === 4) assertions()
      })

      oscTrace2.on('message', function (msg, rinfo) {
        received.push([2, msg])
        if (received.length === 4) assertions()
      })

      client.message('/bla', [1, 2, 3])
      client.message('/blo', ['oui', 'non'])
    })

  })

  describe('disconnections, server', function() {

    beforeEach(function(done) {
      client.config.reconnect = 0
      wsServer.start(config, done)
    })

    it('should forget the socket', function(done) {
      assert.equal(wsServer.sockets().length, 0)
      assert.equal(client.status(), 'stopped')
      async.series([
        function(next) { dummyConnections(2, next) },
        function(next) { client.start(next) },
        function(next) {
          client.listen('/someAddr', function() {}, function(err) {
            assert.equal(wsServer.nsTree.get('/someAddr').data.sockets.length, 1)
            next(err)
          }) 
        },
        function(next) {
          assert.equal(wsServer.sockets().length, 3)
          assert.equal(client.status(), 'started')
          client.stop(next)
        }
      ], function(err) {
        if (err) throw err
        assert.equal(wsServer.sockets().length, 2)
        assert.equal(client.status(), 'stopped')
        assert.equal(wsServer.nsTree.get('/someAddr').data.sockets.length, 0)
        done()
      })
    })

  })

  describe('disconnections, client', function() {

    beforeEach(function(done) {
      client.config.reconnect = 1 // Just so that reconnect is not null and therefore it is handled
      async.series([
        function(next) { wsServer.start(config, next) },
        function(next) { client.start(next) },
        function(next) { client.listen('/someAddr', function() {}, next) }
      ], done)
    })

    var assertConnected = function() {
      assert.equal(wsServer.nsTree.get('/someAddr').data.sockets.length, 1)
      assert.ok(_.isNumber(client.userId))
      assert.equal(client.status(), 'started')
    }

    var assertDisconnected = function() {
      assert.equal(client.status(), 'stopped')
    }

    it('should reconnect', function(done) {
      client.config.reconnect = 50
      assertConnected()
      async.series([
        function(next) {
          wsServer.forget(wsServer.sockets()[0])
          setTimeout(next, 20)
        },
        function(next) {
          assertDisconnected()
          setTimeout(next, 100)
        },
        function(next) {
          assertConnected()
          next()
        }
      ], done)
    })

    it('should work as well when retrying several times', function(done) {
      client.config.reconnect = 50
      assertConnected()
      async.series([
        function(next) {
          wsServer.forget(wsServer.sockets()[0])
          wsServer.stop()
          setTimeout(next, 250) // wait for a few retries
        },
        function(next) {
          assertDisconnected()
          wsServer.start(config, next)
        },
        function(next) { setTimeout(next, 150) }, // wait for reconnection to happen
        function(next) {
          assertConnected()
          wsServer.stop() // do it again
          setTimeout(next, 250)
        },

        function(next) {
          assertDisconnected()
          wsServer.start(config, next)
        },
        function(next) { setTimeout(next, 75) }, // wait for reconnection to happen
        function(next) {
          assertConnected()
          next()
        }
      ], done)
    })

  })

})
