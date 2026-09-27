import { describe, expect, it } from 'vitest';
import { defaultSettings, mergeSettings } from './defaults';
import { parseXmp } from './xmp';

const SAMPLE = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:Exposure2012="+0.60" crs:Contrast2012="-30" crs:Highlights2012="-54" crs:Shadows2012="+34"
   crs:Whites2012="+13" crs:Blacks2012="+78" crs:IncrementalTemperature="-8" crs:IncrementalTint="+5"
   crs:Vibrance="+46" crs:Saturation="+49" crs:Clarity2012="-57" crs:Dehaze="-22" crs:GrainAmount="72"
   crs:HueAdjustmentOrange="+13" crs:SaturationAdjustmentOrange="-13"
   crs:SplitToningHighlightHue="286" crs:SplitToningHighlightSaturation="19"
   crs:ColorGradeMidtoneHue="30" crs:ColorGradeMidtoneSat="5" crs:ColorGradeBlending="60">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Foggy Night</rdf:li></rdf:Alt></crs:Name>
   <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 49</rdf:li><rdf:li>128, 120</rdf:li><rdf:li>255, 234</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

describe('parseXmp', () => {
  it('reads sliders, HSL, grading and tone curve', () => {
    const { name, patch } = parseXmp(SAMPLE, 'fallback');
    expect(name).toBe('Foggy Night');
    const s = mergeSettings(defaultSettings(), patch);
    expect(s.exposure).toBe(0.6);
    expect(s.blacks).toBe(78);
    expect(s.temp).toBe(-8);
    expect(s.grain.amount).toBe(72);
    expect(s.hsl.orange).toEqual({ hue: 13, sat: -13, lum: 0 });
    expect(s.grading.highlights).toEqual({ hue: 286, sat: 19, lum: 0 });
    expect(s.grading.midtones).toEqual({ hue: 30, sat: 5, lum: 0 });
    expect(s.grading.blending).toBe(60);
    expect(s.curve.master).toEqual([[0, 49], [128, 120], [255, 234]]);
  });

  it('falls back to the file name', () => {
    expect(parseXmp('<x/>', 'my-preset').name).toBe('my-preset');
  });
});
