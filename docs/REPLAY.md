# AJRM Marine Logger replay

AJRM Marine Logger replay remains the fastest way to smoke-test Traffic Core
behaviour against real or simulator traffic.

Capture these paths:

```text
vessels.*
vessels.self.plugins.ajrmMarineLogger.playback
vessels.self.plugins.ajrmMarineTraffic.*
vessels.self.notifications.*
```

For an offline summary:

```bash
npm run replay:capture -- /path/to/capture.jsonl.gz \
  --self-context vessels.urn:mrn:imo:mmsi:235008635 \
  --profile coastal
```

The JSON report includes line count, targets seen, projection count, final
sequence, state counts, and up to twenty non-normal alert examples with range,
CPA, and TCPA.
