const fs = require('fs');
const onnxProto = require('onnx-proto');

class ONNXModel {
  constructor() {
    this.filePath = '';
    this.model = null;
    this.inputs = [];
    this.outputs = [];
    this.nodes = [];
    this.metadata = {};
    this.unusedInitializers = [];
  }

  async loadFromFile(filePath) {
    this.filePath = filePath;
    const buffer = fs.readFileSync(filePath);

    const { onnx } = onnxProto;
    if (!onnx?.ModelProto) {
      throw new Error('onnx-proto 中未找到 ModelProto，请检查版本');
    }
    this.model = onnx.ModelProto.decode(buffer);

    // 处理initializer与node的合并
    const initializerMap = new Map();
    this.model.graph.initializer.forEach(tensor => {
      initializerMap.set(tensor.name, tensor);
    });

    this.nodes = this.model.graph.node.map(node => {
      const initializers = [];
      const remainingInputs = [];

      node.input.forEach(inputName => {
        if (initializerMap.has(inputName)) {
          initializers.push({
            name: inputName,
            tensor: initializerMap.get(inputName)
          });
          initializerMap.delete(inputName);
        } else {
          remainingInputs.push(inputName);
        }
      });

      return {
        name: node.name,
        opType: node.opType,
        inputs: remainingInputs,
        initializers: initializers,
        outputs: node.output,
        attribute: node.attribute
      };
    });

    this.metadata = {
      irVersion: this.model.irVersion,
      producerName: this.model.producerName,
      producerVersion: this.model.producerVersion,
      modelVersion: this.model.modelVersion
    };

    this.inputs = this.model.graph.input.map(tensor => ({
      name: tensor.name,
      dataType: tensor.type.tensorType.elemType,
      shape: tensor.type.tensorType.shape.dim.map(d => d.dimValue || d.dimParam)
    }));

    this.outputs = this.model.graph.output.map(tensor => ({
      name: tensor.name,
      dataType: tensor.type.tensorType.elemType,
      shape: tensor.type.tensorType.shape.dim.map(d => d.dimValue || d.dimParam)
    }));

    this.unusedInitializers = Array.from(initializerMap.values());

    return this;
  }

  // 计算模型参数总量
  getTotalParameters() {
    let totalParams = 0;

    // 计算节点中的初始化器参数数量
    this.nodes.forEach(node => {
      node.initializers.forEach(initializer => {
        const tensor = initializer.tensor;
        let paramCount = 1;
        // 计算张量形状的乘积
        if (tensor.dims) {
          tensor.dims.forEach(dim => {
            paramCount *= dim;
          });
        }
        totalParams += paramCount;
      });
    });

    // 计算未使用初始化器的参数数量
    this.unusedInitializers.forEach(tensor => {
      let paramCount = 1;
      if (tensor.dims) {
        tensor.dims.forEach(dim => {
          paramCount *= dim;
        });
      }
      totalParams += paramCount;
    });

    return totalParams;
  }
}

module.exports = ONNXModel;