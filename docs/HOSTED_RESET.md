# Full hosted demo reset

Deploy the latest main commit first. In Render: Dashboard → your web service →
Environment → set ALLOW_DEMO_RESET=true → Save, rebuild and deploy. Keep your
existing ADMIN_TOKEN secret unchanged.

Open https://cantill-procurement-chat.onrender.com and refresh after deployment.
Working as → Procurement → Acting user and admin access → enter your name and
admin token yourself → Import data → Reset disposable demo → Preview full demo
reset → review the deletion preview → check the confirmation box → Confirm full
demo reset.

This removes non-v5.0 policies/drafts, saved runs, raw PRs/batches, chat sessions
and PR-CHAT requests, approvals/orders, local contract allocations, contract drafts
and old audit history. Imported master snapshots, original documents and contract
opening consumption remain unchanged; clearing allocations restores effective
consumption to that imported baseline. One new DEMO_RESET audit event records the
actor and reset. Stop other users/chat/batch activity before confirming.

Then switch ALLOW_DEMO_RESET back to false in Render and redeploy. The same screen
cannot reset while that flag is disabled. There is no need to re-import masters.
Verify Policy updates lists only v5.0, Buyer workspace has no runs, and Audit log
contains only the fresh reset event. Re-upload the sample batch when ready.
