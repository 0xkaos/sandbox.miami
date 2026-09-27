export const vertexShader = `
out vec3 vWorld;
void main() { vWorld = (modelMatrix * vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWorld,1.); }
`;
export const fragmentShader = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uField;
uniform vec3 uMin, uMax, uEye, uLevels, uEnabled;
uniform vec3 uColor0, uColor1, uColor2;
uniform float uWidth, uDensity, uOpacity, uCut;
uniform int uCutAxis;
in vec3 vWorld;
out vec4 outColor;
void main() {
    vec3 rd = normalize(vWorld-uEye);
    vec3 inv = 1. / mix(vec3(1e-7),rd,greaterThan(abs(rd),vec3(1e-7)));
    vec3 t0 = (uMin-uEye)*inv, t1 = (uMax-uEye)*inv;
    vec3 lo = min(t0,t1), hi = max(t0,t1);
    float nearT = max(0.,max(lo.x,max(lo.y,lo.z))), farT = min(hi.x,min(hi.y,hi.z));
    if (farT<=nearT) discard;
    float stepSize = (farT-nearT)/176.;
    vec4 accumulated = vec4(0.);
    for (int i=0; i<176; i++) {
        vec3 p = uEye + rd*(nearT+(float(i)+.5)*stepSize);
        if (uCutAxis>=0 && p[uCutAxis]>uCut) continue;
        vec2 sampleValue = texture(uField,(p-uMin)/(uMax-uMin)).rg;
        if (sampleValue.g<.995) continue;
        vec3 delta = (vec3(sampleValue.r)-uLevels)/uWidth;
        vec3 bands = exp(-.5*delta*delta)*uEnabled;
        float weight = bands.x+bands.y+bands.z;
        vec3 color = (bands.x*uColor0+bands.y*uColor1+bands.z*uColor2)/max(weight,.00001);
        float alpha = 1.-exp(-weight*uDensity*uOpacity*stepSize*3.);
        accumulated.rgb += (1.-accumulated.a)*alpha*color;
        accumulated.a += (1.-accumulated.a)*alpha;
        if (accumulated.a>.985) break;
    }
    if (accumulated.a<.001) discard;
    outColor = vec4(accumulated.rgb/max(accumulated.a,.00001),accumulated.a);
    #ifdef TONE_MAPPING
        outColor.rgb = toneMapping(outColor.rgb);
    #endif
    outColor = linearToOutputTexel(outColor);
}
`;
