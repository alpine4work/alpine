mod assert_message;

use swc_core::{
    ecma::ast::Program,
    ecma::visit::VisitMutWith,
    plugin::{plugin_transform, proxies::TransformPluginProgramMetadata},
};

#[plugin_transform]
pub fn plugin_transform(mut program: Program, _metadata: TransformPluginProgramMetadata) -> Program {
    program.visit_mut_with(&mut assert_message::AssertMessageTransformer::new());
    program
}
