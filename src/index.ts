import Hapi from 'hapi';
import pkg from '../package.json';

interface PluginOptions {

}

const plugin : Hapi.Plugin<PluginOptions> = {
  pkg,
  async register(server : Hapi.Server, options : PluginOptions) {
  }
};

export default plugin;
