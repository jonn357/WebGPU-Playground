const canvas = document.querySelector('#canvas');
canvas.width = innerWidth;
canvas.height = innerHeight;
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const glslang = await glslangModule();

const stage = new Hilo3d.Node();
const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    far: 100,
    near: 0.1,
    z: 3
});
stage.addChild(camera);

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);
const colorBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.6, 0.4, 0.9)
    }),
    x:0.5,
    scaleX:0.5,
    scaleY:0.5,
    scaleZ:0.5,
    onUpdate: function() {
        this.rotationX += .5;
        this.rotationY += .5;
    }
});

stage.addChild(colorBox);

const colorBox1 = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.3, 0.9, 0.6)
    }),
    x:-0.5,
    scaleX:0.2,
    scaleY:0.5,
    scaleZ:0.5,
    onUpdate: function() {
        this.rotationX -= 2;
        this.rotationY -= 2;
    }
});

stage.addChild(colorBox1);

const vs = `#version 450
    layout(set=0, binding=0) uniform Uniforms{
        mat3 u_normalMatrix;
        mat4 u_modelViewProjectionMatrix;
        mat4 u_modelViewMatrix;
        vec3 diffuse;
    } uniforms;

    layout(location=0) in vec3 a_position;
    layout(location=1) in vec3 a_normal;

    layout(location=0) out vec3 v_fragPos;
    layout(location=1) out vec3 v_normal;

    void main(){
        vec4 pos = vec4(a_position, 1.0);
        vec3 normal = a_normal;
        v_normal = normalize(uniforms.u_normalMatrix * normal);
        vec3 fragPos = (uniforms.u_modelViewMatrix * pos).xyz;
        v_fragPos = fragPos;
        gl_Position = uniforms.u_modelViewProjectionMatrix * pos;
    }
`;

const fs = `#version 450
    precision highp float;
    layout(set=0, binding=0) uniform Uniforms{
        mat3 u_normalMatrix;
        mat4 u_modelViewProjectionMatrix;
        mat4 u_modelViewMatrix;
        vec3 diffuse;
    } uniforms;

    layout(location=0) in vec3 v_fragPos;
    layout(location=1) in vec3 v_normal;

    layout(location=0) out vec4 fragColor;

    void main(){
        float light = max(dot(v_normal, vec3(0, 1, 1)), 0.0);
        vec3 normal = normalize(v_normal);
        vec3 diffuse = uniforms.diffuse;
        vec3 color = diffuse * light;
        fragColor = vec4(color, 1);
    }
`;

const context = canvas.getContext('gpupresent');

const swapChainFormat = "bgra8unorm";

const swapChain = context.configureSwapChain({
    device,
    format: swapChainFormat,
});

const verticesData = boxGeometry.vertices.data;
const verticesBuffer = device.createBuffer({
    size: verticesData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
});
new Float32Array(verticesBuffer.getMappedRange()).set(verticesData);
verticesBuffer.unmap();

const indicesData = boxGeometry.indices.data;
const indicesBuffer = device.createBuffer({
    size: indicesData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
});
new Uint16Array(indicesBuffer.getMappedRange()).set(indicesData);
indicesBuffer.unmap();

const normalsData = boxGeometry.normals.data;
const normalsBuffer = device.createBuffer({
    size: normalsData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
});
new Float32Array(normalsBuffer.getMappedRange()).set(normalsData);
normalsBuffer.unmap();

const uniformComponentCount = 16 * 2 + 12 + 4;
const uniformBufferSize = uniformComponentCount * 4;
const alignedUniformSize = Math.ceil(uniformBufferSize / 256) * 256;

const uniformBuffer = device.createBuffer({
    size: alignedUniformSize * 2,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        type: "uniform-buffer",
        hasDynamicOffset: true
    }]
});

const uniformBindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{
        binding: 0,
        resource: {
            buffer: uniformBuffer,
            offset: 0,
            size: uniformBufferSize
        }
    }],
});

const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertexStage: {
        module: device.createShaderModule({
            code: glslang.compileGLSL(vs, "vertex")
        }),
        entryPoint: "main"
    },
    fragmentStage: {
        module: device.createShaderModule({
            code: glslang.compileGLSL(fs, "fragment")
        }),
        entryPoint: "main"
    },
    primitiveTopology: "triangle-list",
    rasterizationState: {
        cullMode: 'back',
    },
    colorStates: [{
        format: swapChainFormat
    }],
    vertexState: {
        vertexBuffers:[{
            arrayStride: 3 * 4,
            attributes:[{
                shaderLocation: 0,
                offset: 0,
                format: "float3"
            }]
        }, {
            arrayStride: 3 * 4,
            attributes:[{
                shaderLocation: 1,
                offset: 0,
                format: "float3"
            }]
        }]
    }
});

const renderPassDescriptor = {
    colorAttachments: [{
        attachment: null,
        loadValue: {
            r: .9,
            g: .6,
            b: .3,
            a: 1
        },
    }],
};  

function getUniformData(mesh){
    const unifromData = mesh._uniformData = mesh._uniformData || new Float32Array(uniformComponentCount);
    let offset = 0;
    
    unifromData.set(Hilo3d.semantic.MODELVIEWINVERSETRANSPOSE.get(mesh), offset);
    unifromData.copyWithin(offset + 4, offset + 3, offset + 6);
    unifromData.copyWithin(offset + 8, offset + 6, offset + 9);
    offset += 12;
    
    unifromData.set(Hilo3d.semantic.MODELVIEWPROJECTION.get(mesh), offset);
    offset += 16;

    unifromData.set(Hilo3d.semantic.MODELVIEW.get(mesh), offset);
    offset += 16;

    unifromData.set(mesh.material.diffuse.elements, offset);
    offset += 4;
    return unifromData;
}

const renderList = new Hilo3d.RenderList();
function render(dt) {
    Hilo3d.semantic.init({}, {}, camera);
    stage.traverseUpdate(dt);
    stage.updateMatrixWorld();
    camera.updateViewProjectionMatrix();
    renderList.reset();
    
    stage.traverse((node) => {
        if (!node.visible) {
            return Node.TRAVERSE_STOP_CHILDREN;
        }

        if (node.isMesh) {
            renderList.addMesh(node, camera);
        }

        return Node.TRAVERSE_STOP_NONE;
    });

    const commandEncoder = device.createCommandEncoder({});
    renderPassDescriptor.colorAttachments[0].attachment = swapChain.getCurrentTexture().createView();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

    renderList.sort();
    let uniformOffset = 0;
    renderList.traverse((mesh => {
        renderMesh(mesh, uniformOffset, passEncoder);
        uniformOffset += alignedUniformSize;
    }));

    passEncoder.endPass();
    device.defaultQueue.submit([commandEncoder.finish()]);
}

function renderMesh(mesh, uniformOffset, passEncoder) {
    device.defaultQueue.writeBuffer(uniformBuffer, uniformOffset, getUniformData(mesh));

    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, uniformBindGroup, [uniformOffset]);
    passEncoder.setVertexBuffer(0, verticesBuffer);
    passEncoder.setVertexBuffer(1, normalsBuffer);
    passEncoder.setIndexBuffer(indicesBuffer, 'uint16');
    passEncoder.drawIndexed(boxGeometry.indices.count, 1, 0, 0, 0);
}

const ticker = new Hilo3d.Ticker(60);
ticker.start();
ticker.addTick({
    tick(dt){
        render(dt);
    }
});
