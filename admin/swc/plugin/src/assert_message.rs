use std::collections::HashSet;

use swc_core::{
    common::DUMMY_SP,
    ecma::{
        ast::*,
        codegen::to_code,
        visit::{VisitMut, VisitMutWith},
    },
};

const ASSERT_MODULE: &str = "~/shared/helpers/control/assert.js";
const ASSERT_EXISTS_MODULE: &str = "~/shared/helpers/control/assert_exists.js";

#[derive(Clone, Copy)]
enum AssertKind {
    Assert,
    AssertExists,
}

pub struct AssertMessageTransformer {
    assert_ids: HashSet<Id>,
    assert_exists_ids: HashSet<Id>,
    assert_namespace_ids: HashSet<Id>,
    assert_exists_namespace_ids: HashSet<Id>,
}

impl AssertMessageTransformer {
    pub fn new() -> Self {
        Self {
            assert_ids: HashSet::new(),
            assert_exists_ids: HashSet::new(),
            assert_namespace_ids: HashSet::new(),
            assert_exists_namespace_ids: HashSet::new(),
        }
    }

    fn collect_imports(&mut self, items: &[ModuleItem]) {
        for item in items {
            let ModuleItem::ModuleDecl(ModuleDecl::Import(import_decl)) = item else {
                continue;
            };

            let module_path = import_decl.src.value.as_str().unwrap_or("");

            let is_assert = module_path == ASSERT_MODULE;
            let is_assert_exists = module_path == ASSERT_EXISTS_MODULE;

            if !is_assert && !is_assert_exists {
                continue;
            }

            for specifier in &import_decl.specifiers {
                match specifier {
                    ImportSpecifier::Named(named) => {
                        let imported_name = match &named.imported {
                            Some(ModuleExportName::Ident(ident)) => ident.sym.as_ref(),
                            Some(ModuleExportName::Str(str)) => str.value.as_str().unwrap_or(""),
                            None => named.local.sym.as_ref(),
                        };

                        if is_assert && imported_name == "assert" {
                            self.assert_ids.insert(named.local.to_id());
                        }

                        if is_assert_exists && imported_name == "assertExists" {
                            self.assert_exists_ids.insert(named.local.to_id());
                        }
                    }
                    ImportSpecifier::Namespace(namespace) => {
                        if is_assert {
                            self.assert_namespace_ids.insert(namespace.local.to_id());
                        }

                        if is_assert_exists {
                            self.assert_exists_namespace_ids
                                .insert(namespace.local.to_id());
                        }
                    }
                    ImportSpecifier::Default(_) => {}
                }
            }
        }
    }

    fn callee_kind(&self, callee: &Callee) -> Option<AssertKind> {
        let Callee::Expr(callee_expr) = callee else {
            return None;
        };

        match &**callee_expr {
            Expr::Ident(ident) => {
                let id = ident.to_id();
                if self.assert_ids.contains(&id) {
                    Some(AssertKind::Assert)
                } else if self.assert_exists_ids.contains(&id) {
                    Some(AssertKind::AssertExists)
                } else {
                    None
                }
            }
            Expr::Member(member) => {
                let MemberExpr {
                    obj,
                    prop: MemberProp::Ident(prop_ident),
                    ..
                } = member
                else {
                    return None;
                };

                let Expr::Ident(obj_ident) = &**obj else {
                    return None;
                };

                let obj_id = obj_ident.to_id();

                if self.assert_namespace_ids.contains(&obj_id) && prop_ident.sym == *"assert" {
                    return Some(AssertKind::Assert);
                }

                if self.assert_exists_namespace_ids.contains(&obj_id)
                    && prop_ident.sym == *"assertExists"
                {
                    return Some(AssertKind::AssertExists);
                }

                None
            }
            _ => None,
        }
    }
}

impl VisitMut for AssertMessageTransformer {
    fn visit_mut_module(&mut self, module: &mut Module) {
        self.collect_imports(&module.body);
        module.body.visit_mut_with(self);
    }

    fn visit_mut_script(&mut self, script: &mut Script) {
        script.body.visit_mut_with(self);
    }

    fn visit_mut_call_expr(&mut self, call: &mut CallExpr) {
        call.visit_mut_children_with(self);

        if call.args.len() != 1 {
            return;
        }

        if call.args[0].spread.is_some() {
            return;
        }

        if self.callee_kind(&call.callee).is_none() {
            return;
        }

        let expr_string = expression_to_string(&call.args[0].expr);
        let message = format!("`{}`", expr_string);

        call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(Str {
                span: DUMMY_SP,
                value: message.into(),
                raw: None,
            }))),
        });
    }
}

fn expression_to_string(expr: &Expr) -> String {
    to_code(expr)
}
