Access Control
===

Access control is the ability to restrict users from accessing some part of the system. The app stack platform 
comes with its own extensible access control system. Fundamentally, use access is controlled by assigning 
security policies to users or groups. A security policy is simply a statement defining the permissions granted 
to a principal relating to a permission. 

Security Policies
---
A security policy is a tuple of `principal`, `resource` and `permissions`. A permission is simply an integer 
interpreted as a bitwise field of (CREATE | READ | UPDATE | DELETE | EXECUTE). For example, permission granting
CREATE and READ permissions would be of binary value `11000b` or `0x18` in HEX.

Resources 
---
A resource is a data object with a type and uniquely identifiable by the attribute `uid`. They can be
referenced by a `resource path` with the format `{type}/{uid}`. For example;

```
contact/abc123  #A contact with UID 'abc123'
```
A wildcard can be used instead of a UID to indicate that the security policy applies to all resource of a particular
type:
```
contact/*  # All contacts in the system
```
In some cases, we may want to apply permissions to a subset of a type. For example, we may want to grant permissions to 
the contacts owned by a specific user UID=1234, then we would use a resource path that would filter based on attribute 
value:
```
contact/[ownerUid="1234"]  # All contacts where the ownerUid attribute is "1234"
```

Principal
---
A princpal refers to a single user or a single group. Users and groups are resources as well with the resource path
`user/${userUid}` or `group/${groupUid}` correspondingly. Multiple security policies may be assigned to a single principal
in order define a comprehensive access control model. Furthermore, security policies assigned to a group are inheritied by 
members of the group. If multiple security policies define different permissions for the same resource, they are
applied in an additive manner. 

Putting it all together
---
A security policy with the following attributes:
```
principal: 'user/kai1234'
resource: 'contact/email_1234'
permission: 0x09
```
The above policy grants the user (UID=kai1234) the permission to READ or EXECUTE (ie send to) on the contact record 
with UID `email_1234`. Exactly what constitutes to READ or EXECUTE are subjected to individual implementation. 

How to use
===
Before accessing a protected resource, first create a `SecurityContext`. For that, you will need the principal UID. Once
you have your `SecurityContext`, simply call `hasPermissions` to check if the principal is allowed to access a particular resource.  
Example:

```typescript
// Check if principal (UID=kai1234) has READ access to some protected document with UID="XYZ123"

import { SecurityContext } from 'api/src/platform/accessControl';

// 1. Construct the security context for the user
const securityContext = new SecurityContext('user/kai1234');
// 2. Check to see if the user has READ permission for document
const hasPermission = await securityContext.hasPermissions(0x80, 'document/XYZ123');
if(hasPermission) {
  // Do stuff
} else {
  throw new Error('Access denied');
}
```

Frequently asked questions
===
1. **Who gets to create security policies and assign permissions?**  
   Security policies are resources themselves. Whoever has permissions to CREATE `securityPolicy/*` will be allowed to
   assign permissions. By default there will be a `root` user created by the platform when it starts up.