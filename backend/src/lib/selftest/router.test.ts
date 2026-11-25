import { describe, expect, it } from 'vitest';

import {
  controlEndpoint,
  defaultGateway,
  natpmpRequest,
  parseExternalIp,
  parseNatpmpResponse,
  parseSsdpLocation,
  routerWanAddress,
  soapExternalIpRequest,
} from './router.js';

describe('NAT-PMP', () => {
  it('asks the router for its external address with a 2-byte request', () => {
    expect([...natpmpRequest()]).toEqual([0, 0]);
  });
  it('reads the external address out of a success answer', () => {
    const res = Buffer.from([0, 128, 0, 0, 0, 0, 0, 1, 203, 0, 113, 9]);
    expect(parseNatpmpResponse(res)).toBe('203.0.113.9');
  });
  it('ignores a failure code, a wrong opcode and a short packet', () => {
    expect(
      parseNatpmpResponse(Buffer.from([0, 128, 0, 3, 0, 0, 0, 1, 203, 0, 113, 9])),
    ).toBeUndefined();
    expect(
      parseNatpmpResponse(Buffer.from([0, 129, 0, 0, 0, 0, 0, 1, 203, 0, 113, 9])),
    ).toBeUndefined();
    expect(parseNatpmpResponse(Buffer.from([0, 128]))).toBeUndefined();
  });
});

describe('default gateway', () => {
  const route = [
    'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
    'eth0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
    'eth0\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0',
  ].join('\n');
  it('reads the gateway of the default route from /proc/net/route', () => {
    expect(defaultGateway(route)).toBe('192.168.0.1');
  });
  it('has none when there is no default route', () => {
    expect(defaultGateway('Iface\tDestination\tGateway\n')).toBeUndefined();
  });
});

describe('UPnP', () => {
  it('finds the description URL in an SSDP answer', () => {
    const res =
      'HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nlocation: http://192.168.0.1:5000/rootDesc.xml\r\nST: x\r\n\r\n';
    expect(parseSsdpLocation(res)).toBe('http://192.168.0.1:5000/rootDesc.xml');
    expect(parseSsdpLocation('HTTP/1.1 200 OK\r\n\r\n')).toBeUndefined();
  });

  const xml = `<root><device><serviceList>
    <service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service>
    <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service>
  </serviceList></device></root>`;
  it('finds the WAN connection control address, as a full URL', () => {
    expect(controlEndpoint(xml, 'http://192.168.0.1:5000/rootDesc.xml')).toEqual({
      url: 'http://192.168.0.1:5000/ctl/IPConn',
      serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1',
    });
  });
  it('also knows the PPP flavour, and says nothing for a router without one', () => {
    const ppp = xml.replace('WANIPConnection', 'WANPPPConnection');
    expect(controlEndpoint(ppp, 'http://r/d.xml')?.serviceType).toContain('WANPPPConnection');
    expect(controlEndpoint('<root/>', 'http://r/d.xml')).toBeUndefined();
  });
  it('builds the GetExternalIPAddress request and reads its answer', () => {
    expect(soapExternalIpRequest('urn:x:WANIPConnection:1')).toContain(
      '<u:GetExternalIPAddress xmlns:u="urn:x:WANIPConnection:1"',
    );
    expect(
      parseExternalIp(
        '<s:Envelope><NewExternalIPAddress>198.51.100.7</NewExternalIPAddress></s:Envelope>',
      ),
    ).toBe('198.51.100.7');
    expect(parseExternalIp('<s:Fault/>')).toBeUndefined();
  });
});

describe('routerWanAddress', () => {
  it('uses NAT-PMP when the router answers it', async () => {
    expect(
      await routerWanAddress({
        natpmp: async () => '203.0.113.9',
        upnp: async () => '198.51.100.1',
      }),
    ).toEqual({ address: '203.0.113.9', via: 'NAT-PMP' });
  });
  it('falls back to UPnP', async () => {
    expect(
      await routerWanAddress({ natpmp: async () => undefined, upnp: async () => '198.51.100.1' }),
    ).toEqual({ address: '198.51.100.1', via: 'UPnP' });
  });
  it('says nothing, never throws, when the router answers neither', async () => {
    expect(
      await routerWanAddress({ natpmp: async () => undefined, upnp: async () => undefined }),
    ).toBeUndefined();
    const boom = async () => {
      throw new Error('EACCES');
    };
    expect(await routerWanAddress({ natpmp: boom, upnp: boom })).toBeUndefined();
  });
});
