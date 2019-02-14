'use strict'

const Peer = require('peer-info')
const os = require('os')
const debug = require('debug')
const log = debug('libp2p:mdns')
const Multiaddr = require('multiaddr')
const Id = require('peer-id')
const TCP = require('libp2p-tcp')
const tcp = new TCP()

module.exports = {

  queryLAN: function (mdns, serviceTag, interval) {
    const query = () => {
      log('query', serviceTag)
      mdns.query({
        questions: [{
          name: serviceTag,
          type: 'PTR'
        }]
      })
    }

    // Immediately start a query, then do it every interval.
    query()
    return setInterval(query, interval)
  },

  gotResponse: function (rsp, peerInfo, serviceTag, callback) {
    if (!rsp.answers) { return }

    const answers = {
      ptr: {},
      txt: [],
    }

    rsp.answers.forEach((answer) => {
      switch (answer.type) {
        case 'PTR': answers.ptr = answer; break
        default: break
      }
    })

    rsp.additionals.forEach((additional) => {
      switch (additional.type) {
        case 'TXT': answers.txt.push(additional); break
        default: break
      }
    })

    if (answers.ptr.name !== serviceTag) {
      return
    }

    const peers = {};
    answers.txt.forEach((txt) => {
      const dnsaddr = txt.data[0].toString().split('=')[1].split('/p2p/')
      const b58Id = dnsaddr[1]

      if (peerInfo.id.toB58String() === b58Id) {
        return // replied to myself, ignore
      }

      const multiaddrs = peers[b58Id] || []
      multiaddrs.push(new Multiaddr(dnsaddr[0]))
      peers[b58Id] = multiaddrs
    })

    Object.keys(peers).forEach((b58Id) => {
      console.log('peer found -', b58Id)

      const peerId = Id.createFromB58String(b58Id)
      Peer.create(peerId, (err, peerFound) => {
        if (err) {
          return log('Error creating PeerInfo from new found peer', err)
        }

        peers[b58Id].forEach((addr) => peerFound.multiaddrs.add(addr))

        callback(null, peerFound)
      })
    })
  },

  gotQuery: function (qry, mdns, peerInfo, serviceTag, broadcast) {
    if (!broadcast) { return }

    const multiaddrs = tcp.filter(peerInfo.multiaddrs.toArray())
    // Only announce TCP for now
    if (multiaddrs.length === 0) { return }

    if (qry.questions[0] && qry.questions[0].name === serviceTag) {
      const response = {
        answers: [],
        additionals: [],
      }

      response.answers.push({
        name: serviceTag,
        type: 'PTR',
        class: 'IN',
        ttl: 120,
        data: peerInfo.id.toB58String() + '.' + serviceTag
      })

      // Only announce TCP multiaddrs for now
      const port = multiaddrs[0].toString().split('/')[4]

      multiaddrs.forEach((ma) => {
        const addr = ma.toString().split('/')
        addr.pop()
        addr.pop()
        addr.push('p2p')
        addr.push(peerInfo.id.toB58String())

        response.additionals.push({
          name: peerInfo.id.toB58String() + '.' + serviceTag,
          type: 'TXT',
          class: 'IN',
          ttl: 120,
          data: 'dnsaddr=' + addr.join('/'),
        })
      })

      mdns.respond(response)
    }
  }
}
